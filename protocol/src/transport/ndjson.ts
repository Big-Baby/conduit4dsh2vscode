import type { JsonRpcMessage } from '../jsonrpc';

/** Serializes one message as a single NDJSON frame. */
export function encodeFrame(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Incremental line decoder for NDJSON streams.
 *
 * Kept intentionally small: it buffers partial lines, drops empty ones and
 * surfaces complete lines to the caller. Frame size limits are enforced by the
 * server, which knows the transport budget.
 */
export class LineDecoder {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) lines.push(line);
      index = this.buffer.indexOf('\n');
    }
    return lines;
  }

  /** Returns and clears any trailing partial line. */
  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest;
  }
}
