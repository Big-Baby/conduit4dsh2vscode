import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { resolveCli } from './cli';

export type TransportKind = 'stdio' | 'tcp' | 'unix';

export interface TransportOptions {
  kind: TransportKind;
  cliPath: string;
  home: string;
  profile: string;
  cwd: string;
  permissionMode: string;
  liveAgentLoop: boolean;
  host: string;
  port: number;
  socketPath: string;
  token: string;
}

export interface FrameTransport {
  start(): Promise<void>;
  send(frame: string): void;
  close(): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (reason: string) => void): void;
  onError(listener: (error: Error) => void): void;
}

/**
 * Byte transport for NDJSON frames.
 *
 * Two implementations share one contract: a child process speaking over stdio,
 * and a socket. Protocol concerns stay in the client.
 */
export function createTransport(options: TransportOptions): FrameTransport {
  return options.kind === 'stdio' ? new ProcessTransport(options) : new SocketTransport(options);
}

class ProcessTransport implements FrameTransport {
  private process: ChildProcess | undefined;
  private dataListeners: Array<(chunk: string) => void> = [];
  private closeListeners: Array<(reason: string) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  constructor(private readonly options: TransportOptions) {}

  async start(): Promise<void> {
    const cli = await resolveCli(this.options.cliPath);
    const args = [...cli.prefixArgs, '--profile', this.options.profile];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_PERMISSION_MODE: this.options.permissionMode.trim() || 'workspace-write',
      DSH_RPC_LIVE: this.options.liveAgentLoop ? '1' : '0',
    };
    if (this.options.home.trim()) env.DSH_HOME = this.options.home.trim();

    const child = spawn(cli.command, args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const listener of this.dataListeners) listener(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // Diagnostics from the harness are surfaced as an error channel instead
      // of being parsed as protocol frames.
      for (const listener of this.errorListeners) listener(new Error(chunk.toString('utf8').trim()));
    });
    child.on('error', (error) => {
      for (const listener of this.errorListeners) listener(error);
    });
    child.on('exit', (code, signal) => {
      for (const listener of this.closeListeners) listener(`process exited (code=${code}, signal=${signal})`);
    });
  }

  send(frame: string): void {
    this.process?.stdin?.write(frame);
  }

  close(): void {
    this.process?.kill();
    this.process = undefined;
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener);
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }
}

class SocketTransport implements FrameTransport {
  private socket: Socket | undefined;
  private dataListeners: Array<(chunk: string) => void> = [];
  private closeListeners: Array<(reason: string) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  constructor(private readonly options: TransportOptions) {}

  async start(): Promise<void> {
    const socket =
      this.options.kind === 'tcp'
        ? connect({ host: this.options.host, port: this.options.port })
        : connect({ path: this.options.socketPath });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    socket.on('data', (chunk: Buffer) => {
      for (const listener of this.dataListeners) listener(chunk.toString('utf8'));
    });
    socket.on('error', (error) => {
      for (const listener of this.errorListeners) listener(error);
    });
    socket.on('close', () => {
      for (const listener of this.closeListeners) listener('socket closed');
    });
  }

  send(frame: string): void {
    if (!this.socket?.destroyed) this.socket?.write(frame);
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener);
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }
}
