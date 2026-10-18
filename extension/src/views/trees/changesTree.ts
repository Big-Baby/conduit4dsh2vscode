import * as vscode from 'vscode';
import type { ChangeSummary, FileChange } from '../../core/changes/types';
import type { ChangeTracker } from '../../core/changes/tracker';
import { formatBytes } from '../../util/format';
import { BaseTree } from './base';

const TYPE_ICON: Record<FileChange['type'], string> = {
  added: 'diff-added',
  modified: 'diff-modified',
  deleted: 'diff-removed',
};

const TYPE_LABEL: Record<FileChange['type'], string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
};

export class ChangesTreeProvider extends BaseTree<FileChange> {
  private summaryValue: ChangeSummary = { mode: 'none', changes: [], total: 0, truncated: false };
  private readonly subscription: vscode.Disposable;

  constructor(private readonly tracker: ChangeTracker) {
    super();
    this.subscription = tracker.onDidChange(() => void this.load());
  }

  get summary(): ChangeSummary {
    return this.summaryValue;
  }

  async load(): Promise<void> {
    try {
      this.summaryValue = await this.tracker.summary();
    } catch {
      this.summaryValue = { mode: 'none', changes: [], total: 0, truncated: false };
    }
    this.refresh();
  }

  getChildren(): FileChange[] {
    return this.summaryValue.changes;
  }

  getTreeItem(change: FileChange): vscode.TreeItem {
    const item = new vscode.TreeItem(change.relPath, vscode.TreeItemCollapsibleState.None);
    item.id = change.relPath;
    item.contextValue = 'change';
    const delta =
      change.sizeBefore !== undefined && change.sizeAfter !== undefined
        ? `${formatBytes(change.sizeBefore)} → ${formatBytes(change.sizeAfter)}`
        : change.sizeAfter !== undefined
          ? formatBytes(change.sizeAfter)
          : change.sizeBefore !== undefined
            ? formatBytes(change.sizeBefore)
            : '';
    item.description = [TYPE_LABEL[change.type], delta].filter(Boolean).join(' · ');
    item.tooltip = [
      change.relPath,
      `type: ${TYPE_LABEL[change.type]}`,
      change.hasBefore ? 'baseline content available' : 'no baseline content (new file)',
    ].join('\n');
    item.iconPath = new vscode.ThemeIcon(TYPE_ICON[change.type]);
    item.command = { command: 'dsh.openChange', title: 'Open diff', arguments: [change] };
    return item;
  }

  override dispose(): void {
    this.subscription.dispose();
    super.dispose();
  }
}
