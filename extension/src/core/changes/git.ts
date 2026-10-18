import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function exec(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: 'spawn error' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function git(args: string[], cwd: string): Promise<ExecResult> {
  return exec('git', args, cwd);
}

export async function findRepoRoot(directory: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '--show-toplevel'], directory);
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export async function hasHead(repoRoot: string): Promise<boolean> {
  const result = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repoRoot);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export function baselineRef(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 12);
  return `refs/dsh/baseline-${hash}`;
}

/**
 * Creates a commit object containing the working tree, including untracked
 * files, and keeps it alive through a private ref.
 *
 * This yields a full baseline snapshot without touching the branch, the index
 * or the working tree. With no local changes, HEAD is used instead.
 */
export async function createBaselineCommit(repoRoot: string): Promise<string | undefined> {
  const stash = await git(['stash', 'create', '--include-untracked'], repoRoot);
  const sha = stash.stdout.trim();
  if (stash.code === 0 && sha) {
    const ref = await git(['update-ref', baselineRef(repoRoot), sha], repoRoot);
    if (ref.code === 0) return sha;
  }

  const head = await git(['rev-parse', 'HEAD'], repoRoot);
  return head.code === 0 ? head.stdout.trim() || undefined : undefined;
}

export async function diffNameStatus(
  repoRoot: string,
  baselineSha: string,
): Promise<Array<{ type: 'added' | 'modified' | 'deleted'; path: string }>> {
  const changes: Array<{ type: 'added' | 'modified' | 'deleted'; path: string }> = [];
  const tracked = await git(['diff', '--no-renames', '--name-status', baselineSha], repoRoot);

  if (tracked.code === 0) {
    for (const line of tracked.stdout.split('\n')) {
      const raw = line.replace(/\s+$/, '');
      if (!raw) continue;
      const [status, ...rest] = raw.split('\t');
      const path = rest.join('\t').trim();
      if (!status || !path) continue;
      const type = status.startsWith('A') ? 'added' : status.startsWith('D') ? 'deleted' : 'modified';
      changes.push({ type, path });
    }
  }

  // Files absent from the baseline are additions.
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], repoRoot);
  if (untracked.code === 0) {
    const seen = new Set(changes.map((change) => change.path));
    for (const line of untracked.stdout.split('\n')) {
      const path = line.replace(/\s+$/, '');
      if (!path || seen.has(path)) continue;
      changes.push({ type: 'added', path });
    }
  }
  return changes;
}

export async function showFile(
  repoRoot: string,
  baselineSha: string,
  repoRelativePath: string,
): Promise<string | undefined> {
  const result = await git(['show', `${baselineSha}:${repoRelativePath}`], repoRoot);
  return result.code === 0 ? result.stdout : undefined;
}

export async function restoreFile(
  repoRoot: string,
  baselineSha: string,
  repoRelativePath: string,
): Promise<boolean> {
  const result = await git(['checkout', baselineSha, '--', repoRelativePath], repoRoot);
  return result.code === 0;
}

export async function commitAll(repoRoot: string, message: string): Promise<boolean> {
  const add = await git(['add', '-A'], repoRoot);
  if (add.code !== 0) return false;
  const commit = await git(['commit', '-m', message], repoRoot);
  return commit.code === 0;
}
