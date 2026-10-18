import { timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import {
  ErrorCode,
  MAX_FRAME_BYTES,
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from '@conduit4dsh2vscode/protocol';
import type { Logger } from '../runtime/logger';
import { Router } from './router';

export interface ServerOptions {
  transport: 'stdio' | 'tcp' | 'unix';
  host: string;
  port: number;
  socketPath: string;
  /** Required for tcp/unix, ignored for stdio. */
  token: string;
}

/** Binds bridge events to notifications. */
export interface NotificationBinding {
  bind(publish: (method: string, params: unknown, sessionId?: string) => void): Array<() => void>;
}

interface ClientContext {
  clientId: string;
  authed: boolean;
  socket?: Socket;
}

/**
 * JSON-RPC 2.0 server over NDJSON.
 *
 * stdio serves exactly one trusted client. tcp/unix serve many, require a token
 * on the first request and filter session notifications by subscription.
 */
export class RpcServer {
  private tcpServer: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly subscriptions = new Map<Socket, Set<string>>();
  private disposers: Array<() => void> = [];
  private ready = false;

  constructor(
    private readonly router: Router,
    private readonly binding: NotificationBinding,
    private readonly options: ServerOptions,
    private readonly log: Logger,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (this.options.transport !== 'stdio' && !this.options.token) {
      throw new Error('a token is required for tcp/unix transports');
    }

    this.disposers = this.binding.bind((method, params, sessionId) =>
      this.broadcast(method, params, sessionId),
    );

    if (this.options.transport === 'stdio') this.startStdio();
    else if (this.options.transport === 'tcp') this.startTcp();
    else this.startUnix();

    this.ready = true;
    this.log.info(`rpc server listening (transport=${this.options.transport}, methods=${this.router.size})`);
  }

  stop(): void {
    this.ready = false;
    for (const dispose of this.disposers) dispose();
    this.disposers = [];

    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.subscriptions.clear();

    this.tcpServer?.close();
    this.tcpServer = undefined;

    if (this.options.transport === 'unix' && existsSync(this.options.socketPath)) {
      try {
        unlinkSync(this.options.socketPath);
      } catch {
        /* another process may have removed it */
      }
    }
    this.log.info('rpc server stopped');
  }

  /* ------------------------------ transports ------------------------------ */

  private startStdio(): void {
    const reader = createInterface({ input: process.stdin, terminal: false });
    const context: ClientContext = { clientId: 'stdio', authed: true };
    const send = (response: JsonRpcResponse): void => {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    };

    reader.on('line', (line) => {
      void this.handleLine(line, context, send);
    });
    reader.on('close', () => {
      this.broadcast('system.shutting-down', { reason: 'stdin-closed' });
      setTimeout(() => process.exit(0), 50);
    });
  }

  private startTcp(): void {
    this.tcpServer = createServer((socket) => this.attach(socket));
    this.tcpServer.listen(this.options.port, this.options.host);
  }

  private startUnix(): void {
    this.tcpServer = createServer((socket) => this.attach(socket));
    this.tcpServer.listen(this.options.socketPath);
  }

  private attach(socket: Socket): void {
    const clientId = `${socket.remoteAddress ?? 'local'}:${socket.remotePort ?? 0}`;
    this.sockets.add(socket);
    this.subscriptions.set(socket, new Set());

    const reader = createInterface({ input: socket, terminal: false });
    const context: ClientContext = { clientId, authed: false, socket };
    const send = (response: JsonRpcResponse): void => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
    };

    reader.on('line', (line) => {
      void this.handleLine(line, context, send);
    });

    const cleanup = (): void => {
      const known = this.sockets.delete(socket);
      this.subscriptions.delete(socket);
      reader.close();
      if (known) this.broadcast('system.shutting-down', { reason: 'client-disconnected', clientId });
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  /* ------------------------------ dispatch ------------------------------ */

  private async handleLine(
    line: string,
    context: ClientContext,
    send: (response: JsonRpcResponse) => void,
  ): Promise<void> {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
      send(errorResponse(null, ErrorCode.InvalidRequest, 'frame exceeds size limit'));
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      send(errorResponse(null, ErrorCode.ParseError, 'invalid JSON'));
      return;
    }

    if (isRequest(message)) {
      if (!context.authed && message.method !== 'auth') {
        send(errorResponse(message.id, ErrorCode.AuthFailed, 'authentication required'));
        return;
      }

      if (message.method === 'auth') {
        const token = (message.params as { token?: string } | undefined)?.token;
        if (this.options.token && token !== undefined && safeEqual(token, this.options.token)) {
          context.authed = true;
          send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
        } else {
          send(errorResponse(message.id, ErrorCode.AuthFailed, 'invalid token'));
        }
        return;
      }

      if (message.method === 'system.shutdown') {
        this.broadcast('system.shutting-down', { reason: 'requested', clientId: context.clientId });
      }

      try {
        const result = await this.router.dispatch(message.method, message.params);
        send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
      } catch (error) {
        const code = (error as { code?: number }).code;
        send(
          errorResponse(
            message.id,
            typeof code === 'number' ? code : ErrorCode.InternalError,
            (error as Error).message,
            (error as { data?: unknown }).data,
          ),
        );
      }
      return;
    }

    if (isNotification(message)) {
      this.handleNotification(message, context);
      return;
    }

    if (isResponse(message)) return;
    send(errorResponse(null, ErrorCode.InvalidRequest, 'invalid request'));
  }

  private handleNotification(message: JsonRpcNotification, context: ClientContext): void {
    if (!context.socket) return;
    if (message.method !== 'session.subscribe' && message.method !== 'session.unsubscribe') return;

    const sessionId = (message.params as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) return;

    const set = this.subscriptions.get(context.socket) ?? new Set<string>();
    if (message.method === 'session.subscribe') set.add(sessionId);
    else set.delete(sessionId);
    this.subscriptions.set(context.socket, set);
  }

  /* ------------------------------ notifications ------------------------------ */

  private broadcast(method: string, params: unknown, sessionId?: string): void {
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    const frame = `${JSON.stringify(notification)}\n`;

    if (this.options.transport === 'stdio') {
      process.stdout.write(frame);
      return;
    }

    for (const socket of this.sockets) {
      if (socket.destroyed) continue;
      if (sessionId && !this.subscriptions.get(socket)?.has(sessionId)) continue;
      socket.write(frame);
    }
  }
}

function errorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
