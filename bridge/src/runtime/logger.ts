import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface HostLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const MAX_LOG_BYTES = 2 * 1024 * 1024;

/**
 * Diagnostics for the bridge.
 *
 * The harness decides where `ctx.logger` goes and that destination is often not
 * reachable in a stdio session, so a bounded file log is kept alongside it.
 */
export class Logger {
  private writes = 0;

  constructor(
    private readonly file: string,
    private readonly host: HostLogger | undefined,
    private readonly debugEnabled = process.env.DSH_BRIDGE_DEBUG === '1',
  ) {}

  debug(message: string): void {
    if (this.debugEnabled) this.write('debug', message);
  }

  info(message: string): void {
    this.host?.info(message);
    this.write('info', message);
  }

  warn(message: string): void {
    this.host?.warn(message);
    this.write('warn', message);
  }

  error(message: string): void {
    this.host?.error(message);
    this.write('error', message);
  }

  private write(level: LogLevel, message: string): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      if (++this.writes % 64 === 0) this.rotateIfNeeded();
      appendFileSync(this.file, `${new Date().toISOString()} ${level} ${message}\n`, 'utf8');
    } catch {
      // Logging must never take the bridge down.
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.file).size > MAX_LOG_BYTES) truncateSync(this.file, 0);
    } catch {
      /* file may not exist yet */
    }
  }
}
