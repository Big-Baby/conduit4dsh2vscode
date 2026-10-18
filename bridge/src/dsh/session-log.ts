import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 0x28b52ffd;

export interface RawLogEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: unknown;
}

/**
 * Reads harness session logs from disk.
 *
 * Logs are append-only zstd streams; each append is its own frame and a crashed
 * write can leave a truncated one. Frames are therefore located by magic and
 * decompressed individually, so one bad frame never hides the rest of the
 * history.
 */
export function readSessionLog(home: string, sessionId: string): RawLogEvent[] {
  const file = findSessionLog(home, sessionId);
  if (!file) return [];

  let text: string;
  try {
    const buffer = readFileSync(file);
    text = file.endsWith('.zstd') ? decompressFrames(buffer) : buffer.toString('utf8');
  } catch {
    return [];
  }

  const events: RawLogEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RawLogEvent;
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.type === 'session') continue; // file header
      events.push(parsed);
    } catch {
      // A truncated trailing line is expected after a crash.
    }
  }
  return events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Session directories are keyed by a cwd slug, so search instead of guessing. */
export function findSessionLog(home: string, sessionId: string): string | undefined {
  const root = join(home, 'sessions');
  if (!existsSync(root)) return undefined;

  let directories: string[];
  try {
    directories = readdirSync(root);
  } catch {
    return undefined;
  }

  for (const cwdDirectory of directories) {
    const directory = join(root, cwdDirectory, sessionId);
    if (!existsSync(directory)) continue;

    let files: string[];
    try {
      files = readdirSync(directory).filter(
        (name) => name.startsWith('session.v') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')),
      );
    } catch {
      continue;
    }
    if (!files.length) continue;

    // Prefer the newest format version, then the uncompressed copy.
    files.sort(
      (a, b) => versionOf(b) - versionOf(a) || Number(a.endsWith('.zstd')) - Number(b.endsWith('.zstd')),
    );
    return join(directory, files[0] as string);
  }
  return undefined;
}

function versionOf(name: string): number {
  const match = /^session\.v(\d+)/.exec(name);
  return match ? Number(match[1]) : 0;
}

function findMagic(buffer: Buffer, from: number): number {
  for (let index = from; index + 4 <= buffer.length; index += 1) {
    if (
      buffer[index] === (ZSTD_MAGIC >>> 24) &&
      buffer[index + 1] === ((ZSTD_MAGIC >>> 16) & 0xff) &&
      buffer[index + 2] === ((ZSTD_MAGIC >>> 8) & 0xff) &&
      buffer[index + 3] === (ZSTD_MAGIC & 0xff)
    ) {
      return index;
    }
  }
  return -1;
}

function decompressFrames(buffer: Buffer): string {
  const parts: string[] = [];
  let offset = findMagic(buffer, 0);
  while (offset >= 0 && offset < buffer.length) {
    const next = findMagic(buffer, offset + 4);
    const end = next < 0 ? buffer.length : next;
    try {
      parts.push(zstdDecompressSync(buffer.subarray(offset, end)).toString('utf8'));
    } catch {
      // Skip the damaged frame and continue with the next one.
    }
    offset = next;
  }
  return parts.join('');
}
