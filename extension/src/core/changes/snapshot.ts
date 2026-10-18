import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import type { SnapshotEntry, SnapshotManifest } from './types';

const MAX_COPY_SIZE = 512 * 1024;
const COPY_BUDGET = 2000;

export interface WalkedFile {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface SnapshotOptions {
  root: string;
  excludes: RegExp[];
  whitelist: (relPath: string) => boolean;
  maxFiles: number;
}

/** Walks the workspace, skipping excluded and whitelisted paths. */
export function walkWorkspace(options: SnapshotOptions): WalkedFile[] {
  const files: WalkedFile[] = [];
  const stack = [options.root];

  while (stack.length) {
    const directory = stack.pop();
    if (!directory) break;

    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }

    for (const name of entries) {
      const abs = join(directory, name);
      const rel = relative(options.root, abs).split('\\').join('/');
      if (options.excludes.some((re) => re.test(rel))) continue;
      if (options.whitelist(rel)) continue;

      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!stat.isFile()) continue; // symlinks and special files are not tracked

      files.push({ rel, abs, size: stat.size, mtimeMs: stat.mtimeMs });
      if (files.length >= options.maxFiles) return files;
    }
  }
  return files;
}

/**
 * Captures a baseline.
 *
 * Text files below the size limit are copied into the snapshot directory so a
 * revert and a real diff remain possible; metadata alone is recorded otherwise.
 */
export function captureSnapshot(
  options: SnapshotOptions,
  snapshotRoot: string,
  id: string,
): SnapshotManifest {
  const directory = join(snapshotRoot, id);
  mkdirSync(directory, { recursive: true });

  const files = walkWorkspace(options);
  const manifest: SnapshotManifest = {};
  let index = 0;
  let budget = COPY_BUDGET;

  for (const file of files) {
    const entry: SnapshotEntry = { size: file.size, mtimeMs: file.mtimeMs };
    if (budget > 0 && file.size <= MAX_COPY_SIZE) {
      try {
        const buffer = readFileSync(file.abs);
        if (!looksBinary(buffer)) {
          writeFileSync(join(directory, String(index)), buffer);
          entry.copy = index;
          index += 1;
          budget -= 1;
        }
      } catch {
        // Unreadable files are still tracked by metadata.
      }
    }
    manifest[file.rel] = entry;
  }

  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  return manifest;
}

export function readManifest(snapshotRoot: string, snapshotId: string | undefined): SnapshotManifest {
  if (!snapshotId) return {};
  try {
    const file = join(snapshotRoot, snapshotId, 'manifest.json');
    return JSON.parse(readFileSync(file, 'utf8')) as SnapshotManifest;
  } catch {
    return {};
  }
}

export function snapshotCopyPath(
  snapshotRoot: string,
  snapshotId: string | undefined,
  manifest: SnapshotManifest,
  relPath: string,
): string | undefined {
  const entry = manifest[relPath];
  if (!snapshotId || entry?.copy === undefined) return undefined;
  const file = join(snapshotRoot, snapshotId, String(entry.copy));
  return existsSync(file) ? file : undefined;
}

/** Deletes all but the newest snapshots. */
export function pruneSnapshots(snapshotRoot: string, keep = 3): void {
  try {
    const directories = readdirSync(snapshotRoot)
      .filter((name) => name.startsWith('snap-'))
      .sort();
    for (const name of directories.slice(0, Math.max(0, directories.length - keep))) {
      try {
        rmSync(join(snapshotRoot, name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* snapshot root does not exist yet */
  }
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}
