import * as vscode from 'vscode';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  copyFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as git from './git';
import { compileWhitelist, globToRegExp } from './glob';
import {
  captureSnapshot,
  pruneSnapshots,
  readManifest,
  snapshotCopyPath,
  walkWorkspace,
} from './snapshot';
import type {
  Baseline,
  ChangeSummary,
  ConfirmRecord,
  FileChange,
  SnapshotManifest,
} from './types';

const BASELINE_KEY = 'dsh.changes.baseline';
const HISTORY_KEY = 'dsh.changes.history';
const SNAPSHOT_DIR = 'dsh-snapshots';
const DIFF_DIR = 'dsh-diff';
const MAX_HISTORY = 50;

/**
 * Tracks every file changed since the last confirmation.
 *
 * In a git repository the baseline is a dangling commit created with
 * `git stash create`, which captures tracked and untracked files without
 * touching the branch. Outside git, a metadata snapshot with text copies is
 * kept in extension storage.
 */
export class ChangeTracker implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private cache: ChangeSummary | undefined;
  private dirty = true;
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private tempSequence = 0;

  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  /* ------------------------------ configuration ------------------------------ */

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('dsh');
  }

  get enabled(): boolean {
    return this.config.get<boolean>('changes.enabled', true);
  }

  private get excludes(): string[] {
    return this.config.get<string[]>('changes.exclude', [
      '**/node_modules/**',
      '**/.git/**',
      '**/.dsh/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
    ]);
  }

  private get maxFiles(): number {
    return this.config.get<number>('changes.maxFiles', 2000);
  }

  get whitelistPatterns(): string[] {
    return this.config.get<string[]>('changes.whitelist', []);
  }

  async setWhitelist(patterns: string[]): Promise<string[]> {
    const clean = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
    await this.config.update('changes.whitelist', clean, vscode.ConfigurationTarget.Workspace);
    this.invalidate();
    this.output.appendLine(`[changes] whitelist now has ${clean.length} entries`);
    return clean;
  }

  private whitelistMatcher(): (relPath: string) => boolean {
    return compileWhitelist(this.whitelistPatterns);
  }

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private get snapshotRoot(): string {
    return join(this.context.globalStorageUri.fsPath, SNAPSHOT_DIR);
  }

  /* ------------------------------ public API ------------------------------ */

  async summary(force = false): Promise<ChangeSummary> {
    if (!force && this.cache && !this.dirty) return this.cache;

    const root = this.workspaceRoot;
    if (!root || !this.enabled) {
      this.cache = { mode: 'none', changes: [], total: 0, truncated: false };
      this.dirty = false;
      return this.cache;
    }

    let baseline = this.context.workspaceState.get<Baseline>(BASELINE_KEY);
    if (!baseline) {
      baseline = await this.captureBaseline();
      if (!baseline) {
        this.cache = { mode: 'none', changes: [], total: 0, truncated: false };
        this.dirty = false;
        return this.cache;
      }
    }

    const collected =
      baseline.mode === 'git'
        ? await this.collectGit(baseline, root)
        : this.collectSnapshot(baseline, root);

    this.cache = {
      mode: baseline.mode,
      changes: collected.changes,
      total: collected.changes.length,
      truncated: collected.truncated,
      ...(baseline.createdAt ? { confirmedAt: baseline.createdAt } : {}),
    };
    this.dirty = false;
    return this.cache;
  }

  async confirm(): Promise<{ count: number; committed: boolean; mode: 'git' | 'snapshot' }> {
    const summary = await this.summary(true);
    if (!summary.changes.length) {
      return { count: 0, committed: false, mode: summary.mode === 'none' ? 'snapshot' : summary.mode };
    }

    const root = this.workspaceRoot;
    let committed = false;
    if (root && summary.mode === 'git' && this.config.get<boolean>('changes.autoCommitOnConfirm', false)) {
      const repoRoot = await git.findRepoRoot(root);
      if (repoRoot) {
        committed = await git.commitAll(repoRoot, `dsh: confirm ${summary.changes.length} file(s)`);
      }
    }

    const baseline = await this.captureBaseline();
    await this.pushHistory({
      at: new Date().toISOString(),
      count: summary.changes.length,
      mode: baseline?.mode ?? 'snapshot',
      committed,
    });

    this.invalidate();
    this.output.appendLine(
      `[changes] confirmed ${summary.changes.length} change(s), baseline moved (mode=${baseline?.mode ?? 'snapshot'})`,
    );
    return { count: summary.changes.length, committed, mode: baseline?.mode ?? 'snapshot' };
  }

  async resetBaseline(): Promise<void> {
    await this.captureBaseline();
    this.invalidate();
    this.output.appendLine('[changes] baseline reset');
  }

  history(): ConfirmRecord[] {
    return this.context.workspaceState.get<ConfirmRecord[]>(HISTORY_KEY, []);
  }

  async openDiff(change: FileChange): Promise<void> {
    const before = await this.beforeUri(change);
    const after =
      change.type === 'deleted'
        ? await this.tempUri(change.relPath, 'current', '')
        : vscode.Uri.file(change.absPath);
    await vscode.commands.executeCommand('vscode.diff', before, after, `${change.relPath} (baseline → working tree)`);
  }

  async revert(change: FileChange): Promise<boolean> {
    const baseline = this.context.workspaceState.get<Baseline>(BASELINE_KEY);
    const root = this.workspaceRoot;
    if (!baseline || !root) return false;

    if (change.type === 'added') {
      try {
        unlinkSync(change.absPath);
        return true;
      } catch {
        return false;
      }
    }

    if (baseline.mode === 'git' && baseline.gitRoot && baseline.gitRef) {
      const repoRelative = this.toRepoRelative(baseline.gitRoot, root, change.relPath);
      return git.restoreFile(baseline.gitRoot, baseline.gitRef, repoRelative);
    }

    const copy = await this.snapshotCopy(baseline, change.relPath);
    if (!copy) return false;
    try {
      mkdirSync(dirname(change.absPath), { recursive: true });
      copyFileSync(copy, change.absPath);
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------ watching ------------------------------ */

  startWatching(): void {
    if (this.watcher) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**'));
    const schedule = (): void => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.invalidate(), 900);
    };
    this.watcher.onDidChange(schedule);
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidDelete(schedule);
  }

  invalidate(): void {
    this.dirty = true;
    this.changeEmitter.fire();
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.dispose();
    this.changeEmitter.dispose();
  }

  /* ------------------------------ baseline ------------------------------ */

  private async captureBaseline(): Promise<Baseline | undefined> {
    const root = this.workspaceRoot;
    if (!root) return undefined;

    const repoRoot = await git.findRepoRoot(root);
    if (repoRoot && (await git.hasHead(repoRoot))) {
      const sha = await git.createBaselineCommit(repoRoot);
      if (sha) {
        const baseline: Baseline = {
          mode: 'git',
          createdAt: new Date().toISOString(),
          gitRoot: repoRoot,
          gitRef: sha,
        };
        await this.context.workspaceState.update(BASELINE_KEY, baseline);
        return baseline;
      }
    }

    const id = `snap-${Date.now().toString(36)}`;
    captureSnapshot(this.snapshotOptions(root), this.snapshotRoot, id);
    pruneSnapshots(this.snapshotRoot);
    const baseline: Baseline = {
      mode: 'snapshot',
      createdAt: new Date().toISOString(),
      snapshotId: id,
    };
    await this.context.workspaceState.update(BASELINE_KEY, baseline);
    return baseline;
  }

  /* ------------------------------ git mode ------------------------------ */

  private async collectGit(
    baseline: Baseline,
    root: string,
  ): Promise<{ changes: FileChange[]; truncated: boolean }> {
    const repoRoot = baseline.gitRoot;
    const sha = baseline.gitRef;
    if (!repoRoot || !sha) return this.collectSnapshot(baseline, root);

    const alive = await git.exec('git', ['cat-file', '-t', sha], repoRoot);
    if (alive.code !== 0) {
      this.output.appendLine('[changes] baseline commit is gone, switching to snapshot mode');
      const fresh = await this.captureBaseline();
      return fresh ? this.collectSnapshot(fresh, root) : { changes: [], truncated: false };
    }

    const entries = await git.diffNameStatus(repoRoot, sha);
    const prefix = relative(repoRoot, root).split('\\').join('/');
    const whitelisted = this.whitelistMatcher();
    const changes: FileChange[] = [];

    for (const entry of entries) {
      if (prefix && !entry.path.startsWith(`${prefix}/`)) continue;
      const relPath = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
      if (whitelisted(relPath)) continue;

      const absPath = resolve(root, relPath);
      const sizeAfter = existsSync(absPath) ? statSync(absPath).size : undefined;
      changes.push({
        relPath,
        absPath,
        type: entry.type,
        ...(sizeAfter !== undefined ? { sizeAfter } : {}),
        hasBefore: entry.type !== 'added',
      });
    }

    changes.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return { changes: changes.slice(0, this.maxFiles), truncated: changes.length > this.maxFiles };
  }

  private toRepoRelative(repoRoot: string, workspaceRoot: string, relPath: string): string {
    const prefix = relative(repoRoot, workspaceRoot).split('\\').join('/');
    return prefix ? `${prefix}/${relPath}` : relPath;
  }

  /* ------------------------------ snapshot mode ------------------------------ */

  private collectSnapshot(
    baseline: Baseline,
    root: string,
  ): { changes: FileChange[]; truncated: boolean } {
    const manifest = readManifest(this.snapshotRoot, baseline.snapshotId);
    const current = new Map(walkWorkspace(this.snapshotOptions(root)).map((file) => [file.rel, file]));
    const whitelisted = this.whitelistMatcher();
    const changes: FileChange[] = [];

    for (const [relPath, entry] of Object.entries(manifest)) {
      if (whitelisted(relPath)) continue;
      const file = current.get(relPath);

      if (!file) {
        changes.push({
          relPath,
          absPath: resolve(root, relPath),
          type: 'deleted',
          sizeBefore: entry.size,
          hasBefore: entry.copy !== undefined,
        });
        continue;
      }

      if (file.size !== entry.size || Math.floor(file.mtimeMs) !== Math.floor(entry.mtimeMs)) {
        changes.push({
          relPath,
          absPath: file.abs,
          type: 'modified',
          sizeBefore: entry.size,
          sizeAfter: file.size,
          hasBefore: entry.copy !== undefined,
        });
      }
    }

    for (const [relPath, file] of current) {
      if (relPath in manifest) continue;
      changes.push({
        relPath,
        absPath: file.abs,
        type: 'added',
        sizeAfter: file.size,
        hasBefore: false,
      });
    }

    changes.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return { changes: changes.slice(0, this.maxFiles), truncated: changes.length > this.maxFiles };
  }

  private snapshotOptions(root: string): {
    root: string;
    excludes: RegExp[];
    whitelist: (relPath: string) => boolean;
    maxFiles: number;
  } {
    return {
      root,
      excludes: this.excludes.map(globToRegExp),
      whitelist: this.whitelistMatcher(),
      maxFiles: this.maxFiles,
    };
  }

  /* ------------------------------ diff helpers ------------------------------ */

  private async beforeUri(change: FileChange): Promise<vscode.Uri> {
    const baseline = this.context.workspaceState.get<Baseline>(BASELINE_KEY);
    const root = this.workspaceRoot;
    if (!baseline || !root || !change.hasBefore) return this.tempUri(change.relPath, 'before', '');

    if (baseline.mode === 'git' && baseline.gitRoot && baseline.gitRef) {
      const content = await git.showFile(
        baseline.gitRoot,
        baseline.gitRef,
        this.toRepoRelative(baseline.gitRoot, root, change.relPath),
      );
      return this.tempUri(change.relPath, 'before', content ?? '');
    }

    const copy = await this.snapshotCopy(baseline, change.relPath);
    if (!copy) return this.tempUri(change.relPath, 'before', '');
    try {
      return this.tempUri(change.relPath, 'before', readFileSync(copy, 'utf8'));
    } catch {
      return this.tempUri(change.relPath, 'before', '');
    }
  }

  private async snapshotCopy(baseline: Baseline, relPath: string): Promise<string | undefined> {
    const manifest: SnapshotManifest = readManifest(this.snapshotRoot, baseline.snapshotId);
    return snapshotCopyPath(this.snapshotRoot, baseline.snapshotId, manifest, relPath);
  }

  private async tempUri(relPath: string, tag: string, content: string): Promise<vscode.Uri> {
    const directory = join(this.context.globalStorageUri.fsPath, DIFF_DIR);
    mkdirSync(directory, { recursive: true });
    const safe = relPath.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
    const file = join(directory, `${this.tempSequence += 1}-${tag}-${safe}`);
    writeFileSync(file, content, 'utf8');
    return vscode.Uri.file(file);
  }

  private async pushHistory(entry: ConfirmRecord): Promise<void> {
    const history = this.history();
    history.push(entry);
    await this.context.workspaceState.update(HISTORY_KEY, history.slice(-MAX_HISTORY));
  }
}
