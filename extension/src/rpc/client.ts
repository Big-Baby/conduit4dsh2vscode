import * as vscode from 'vscode';
import {
  ErrorCode,
  LineDecoder,
  RpcError,
  isNotification,
  isRequest,
  majorOf,
  notificationMessage,
  requestMessage,
  PROTOCOL_VERSION,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type ServerInfo,
} from '@conduit4dsh2vscode/protocol';
import { createTransport, type FrameTransport, type TransportOptions } from './transport';

export type ClientState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'stopped';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * JSON-RPC client.
 *
 * Responsibilities: framing, request/response correlation, authentication,
 * heartbeat, reconnect and session subscriptions. It has no knowledge of the
 * UI or of domain objects beyond `ServerInfo`.
 */
export class DshClient implements vscode.Disposable {
  private readonly decoder = new LineDecoder();
  private readonly pending = new Map<number, Pending>();
  private readonly stateEmitter = new vscode.EventEmitter<ClientState>();
  private readonly notificationEmitter = new vscode.EventEmitter<{ method: string; params: unknown }>();
  private readonly reconnectEmitter = new vscode.EventEmitter<void>();

  private transport: FrameTransport | undefined;
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private serverInfo: ServerInfo | undefined;
  private currentState: ClientState = 'idle';
  private attempts = 0;
  private disposed = false;
  private readonly subscriptions = new Set<string>();

  readonly onState = this.stateEmitter.event;
  readonly onNotification = this.notificationEmitter.event;
  readonly onReconnected = this.reconnectEmitter.event;

  constructor(
    private readonly options: TransportOptions & { token: string },
    private readonly output: vscode.OutputChannel,
  ) {}

  get state(): ClientState {
    return this.currentState;
  }

  get info(): ServerInfo | undefined {
    return this.serverInfo;
  }

  hasCapability(name: string): boolean {
    return this.serverInfo?.capabilities.includes(name) ?? false;
  }

  async connect(): Promise<ServerInfo> {
    this.disposed = false;
    this.setState('connecting');

    const transport = createTransport(this.options);
    this.transport = transport;
    transport.onData((chunk) => this.consume(chunk));
    transport.onError((error) => this.output.appendLine(`[transport] ${error.message}`));
    transport.onClose((reason) => this.handleClose(reason));

    await transport.start();

    if (this.options.kind !== 'stdio') {
      if (!this.options.token) {
        throw new RpcError(ErrorCode.AuthFailed, 'tcp/unix transport requires dsh.rpcToken');
      }
      await this.request('auth', { token: this.options.token });
    }

    const info = await this.request<ServerInfo>('system.info');
    if (majorOf(info.protocolVersion) !== majorOf(PROTOCOL_VERSION)) {
      throw new RpcError(
        ErrorCode.ProtocolMismatch,
        `protocol mismatch: bridge=${info.protocolVersion} client=${PROTOCOL_VERSION}`,
      );
    }
    if (info.protocolVersion !== PROTOCOL_VERSION) {
      this.output.appendLine(
        `[dsh] bridge protocol ${info.protocolVersion}; degrading by capabilities ` +
          `[${info.capabilities.join(', ') || 'none'}]`,
      );
    }

    this.serverInfo = info;
    this.attempts = 0;
    this.setState('ready');
    this.startHeartbeat();

    for (const sessionId of this.subscriptions) {
      this.notify('session.subscribe', { sessionId });
    }

    this.output.appendLine(
      `[dsh] connected transport=${this.options.kind} dsh=${info.dshVersion} mode=${info.mode}`,
    );
    return info;
  }

  request<T>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.transport) {
        reject(new RpcError(ErrorCode.ServerNotReady, 'not connected'));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(ErrorCode.RequestCancelled, `request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.transport.send(`${JSON.stringify(requestMessage(id, method, params ?? {}))}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.transport?.send(`${JSON.stringify(notificationMessage(method, params))}\n`);
  }

  subscribeSession(sessionId: string): void {
    if (this.subscriptions.has(sessionId)) return;
    this.subscriptions.add(sessionId);
    if (this.currentState === 'ready') this.notify('session.subscribe', { sessionId });
  }

  unsubscribeSession(sessionId: string): void {
    if (!this.subscriptions.delete(sessionId)) return;
    if (this.currentState === 'ready') this.notify('session.unsubscribe', { sessionId });
  }

  /** Subscribes to one notification method. */
  on(method: string, listener: (params: unknown) => void): vscode.Disposable {
    const disposable = this.notificationEmitter.event((event) => {
      if (event.method === method) listener(event.params);
    });
    return disposable;
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    this.setState('stopped');
    this.transport?.close();
    this.transport = undefined;
    for (const [, pending] of this.pending) {
      pending.reject(new RpcError(ErrorCode.ServerNotReady, 'client disposed'));
    }
    this.pending.clear();
    this.stateEmitter.dispose();
    this.notificationEmitter.dispose();
    this.reconnectEmitter.dispose();
  }

  /* ------------------------------ internals ------------------------------ */

  private consume(chunk: string): void {
    for (const line of this.decoder.push(chunk)) {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        // A non-protocol line (banner, stray log) must not break the stream.
        this.output.appendLine(`[dsh] ignored non-JSON output: ${line.slice(0, 160)}`);
        continue;
      }

      if (isRequest(message) || isNotification(message)) {
        if (isNotification(message)) {
          this.notificationEmitter.fire({ method: message.method, params: message.params });
        }
        continue;
      }

      this.resolveResponse(message);
    }
  }

  private resolveResponse(response: JsonRpcResponse): void {
    if (typeof response.id !== 'number') return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new RpcError(response.error.code, response.error.message, response.error.data));
      return;
    }
    pending.resolve(response.result);
  }

  private handleClose(reason: string): void {
    this.stopHeartbeat();
    for (const [, pending] of this.pending) {
      pending.reject(new RpcError(ErrorCode.ServerNotReady, `connection closed: ${reason}`));
    }
    this.pending.clear();

    if (this.disposed || this.currentState === 'stopped') return;
    void this.reconnect(reason);
  }

  private async reconnect(reason: string): Promise<void> {
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setState('stopped');
      this.output.appendLine(`[dsh] reconnect abandoned after ${this.attempts} attempts (${reason})`);
      return;
    }

    this.setState('reconnecting');
    const delay = Math.min(1000 * 2 ** this.attempts, 15_000);
    this.attempts += 1;
    this.output.appendLine(`[dsh] reconnect ${this.attempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      this.transport?.close();
      await this.connect();
      this.reconnectEmitter.fire();
    } catch (error) {
      this.output.appendLine(`[dsh] reconnect failed: ${(error as Error).message}`);
      void this.reconnect((error as Error).message);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.currentState !== 'ready') return;
      this.request('system.ping', {}, 10_000).catch(() => {
        this.output.appendLine('[dsh] heartbeat failed');
        this.transport?.close();
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private setState(state: ClientState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateEmitter.fire(state);
  }
}
