import { existsSync, readdirSync, readFileSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import {
  ErrorCode,
  RpcError,
  isWithin,
  type WorkspaceFile,
  type WorkspaceFileList,
} from '@conduit4dsh2vscode/protocol';

const MAX_WALK_DEPTH = 12;
const DEFAULT_MAX_FILES = 5000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.next',
  '.nuxt',
  '.gradle',
  '.dart_tool',
  '.terraform',
]);

/**
 * File access limited to registered workspaces.
 *
 * Paths are resolved through `realpath` before the containment check, so a
 * symlink inside a workspace cannot be used to reach outside of it.
 */
export class WorkspaceFiles {
  constructor(private readonly roots: () => string[]) {}

  resolve(raw: string): string {
    if (!raw) throw new RpcError(ErrorCode.InvalidParams, 'path is required');
    if (!isAbsolute(raw)) {
      throw new RpcError(ErrorCode.PathOutsideWorkspace, `path must be absolute: ${raw}`);
    }

    const target = normalize(resolve(raw));
    const real = this.realOrSelf(target);
    const roots = this.roots().map((root) => this.realOrSelf(root));

    if (!roots.some((root) => isWithin(root, real) || isWithin(root, target))) {
      throw new RpcError(ErrorCode.PathOutsideWorkspace, `path outside workspace: ${target}`, { path: target });
    }
    return target;
  }

  readText(raw: string): { path: string; content: string } {
    const path = this.resolve(raw);
    if (!existsSync(path)) throw new RpcError(ErrorCode.InvalidParams, `file not found: ${path}`);
    const stat = statSync(path);
    if (!stat.isFile()) throw new RpcError(ErrorCode.InvalidParams, `not a file: ${path}`);
    if (stat.size > MAX_READ_BYTES) {
      throw new RpcError(ErrorCode.FileTooLarge, `file exceeds ${MAX_READ_BYTES} bytes`, { path });
    }
    return { path, content: readFileSync(path, 'utf8') };
  }

  stat(raw: string): { path: string; size: number; mtime: number; isDirectory: boolean } {
    const path = this.resolve(raw);
    if (!existsSync(path)) throw new RpcError(ErrorCode.InvalidParams, `path not found: ${path}`);
    const stat = statSync(path);
    return { path, size: stat.size, mtime: stat.mtimeMs, isDirectory: stat.isDirectory() };
  }

  list(query: string | undefined, maxFiles: number | undefined): WorkspaceFileList {
    const max = Math.min(Math.max(Math.trunc(maxFiles ?? DEFAULT_MAX_FILES) || DEFAULT_MAX_FILES, 1), 20_000);
    const needle = (query ?? '').trim().toLowerCase();
    const files: WorkspaceFile[] = [];
    const seen = new Set<string>();
    let truncated = false;

    for (const root of this.roots()) {
      const walked = walk(root, max);
      if (walked.length >= max) truncated = true;
      for (const entry of walked) {
        if (seen.has(entry.abs)) continue;
        seen.add(entry.abs);
        const path = relative(root, entry.abs).split(sep).join('/');
        if (needle && !path.toLowerCase().includes(needle)) continue;
        files.push({ path, name: basename(entry.abs), size: entry.size, root });
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated };
  }

  private realOrSelf(path: string): string {
    try {
      return normalize(realpathSync(path));
    } catch {
      return normalize(path);
    }
  }
}

function walk(root: string, max: number): Array<{ abs: string; size: number }> {
  const out: Array<{ abs: string; size: number }> = [];
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (stack.length && out.length < max) {
    const current = stack.pop();
    if (!current) break;

    let entries: Dirent[];
    try {
      entries = readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= max) break;
      const abs = join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || current.depth >= MAX_WALK_DEPTH) continue;
        stack.push({ directory: abs, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        try {
          out.push({ abs, size: statSync(abs).size });
        } catch {
          // Removed while walking.
        }
      }
    }
  }
  return out;
}
