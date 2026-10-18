import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Small JSON document store with atomic replacement.
 *
 * The bridge owns a handful of low-volume documents (projects, sessions,
 * providers). A database would be overkill; correctness comes from writing a
 * sibling temp file and renaming it over the target.
 */
export class JsonStore<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
  ) {}

  read(): T {
    try {
      if (!existsSync(this.file)) return this.fallback();
      return JSON.parse(readFileSync(this.file, 'utf8')) as T;
    } catch {
      return this.fallback();
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      renameSync(temp, this.file);
    } catch {
      // Windows refuses to replace an open file; fall back to an in-place write.
      writeFileSync(this.file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      try {
        rmSync(temp, { force: true });
      } catch {
        /* the temp file is harmless */
      }
    }
  }

  update(mutate: (draft: T) => void): T {
    const draft = this.read();
    mutate(draft);
    this.write(draft);
    return draft;
  }
}

/** Appends one JSON line, creating the parent directory on demand. */
export function appendJsonLine(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

/** Reads a JSONL file, skipping malformed lines. */
export function readJsonLines<T>(file: string): T[] {
  try {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
