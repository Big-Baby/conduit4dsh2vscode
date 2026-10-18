import * as vscode from 'vscode';
import { relative } from 'node:path';
import type { FileChange } from '../core/changes/types';
import type { CommandContext } from './context';
import { registerCommand } from './register';

export function registerChangeCommands(
  context: CommandContext,
  subscriptions: vscode.Disposable[],
): void {
  const { changes, trees } = context;

  registerCommand(subscriptions, 'dsh.confirmChanges', async () => {
    const summary = await changes.summary(true);
    if (!summary.total) {
      void vscode.window.showInformationMessage('No changes since the last confirmation.');
      return;
    }

    const counts = summary.changes.reduce<Record<string, number>>((accumulator, change) => {
      accumulator[change.type] = (accumulator[change.type] ?? 0) + 1;
      return accumulator;
    }, {});

    const choice = await vscode.window.showWarningMessage(
      `Confirm ${summary.total} change(s)?\n` +
        `added ${counts.added ?? 0} · modified ${counts.modified ?? 0} · deleted ${counts.deleted ?? 0}\n` +
        'The baseline moves to the current state.',
      { modal: true },
      'Confirm',
      'Review first',
    );
    if (choice === 'Review first') {
      await vscode.commands.executeCommand('dsh-changes.focus');
      return;
    }
    if (choice !== 'Confirm') return;

    const result = await changes.confirm();
    await trees.changes.load();
    await context.syncChanges();
    void vscode.window.showInformationMessage(
      `Confirmed ${result.count} change(s)${result.committed ? ' and created a git checkpoint' : ''}.`,
    );
  });

  registerCommand(subscriptions, 'dsh.compareCode', async () => {
    const summary = await changes.summary(true);
    if (!summary.total) {
      void vscode.window.showInformationMessage('No changes to compare.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      summary.changes.map((change) => ({
        label: change.relPath,
        description: change.type,
        ...(change.hasBefore ? {} : { detail: 'No baseline content' }),
        change,
      })),
      { title: `Compare with baseline (${summary.total} files)`, matchOnDescription: true },
    );
    if (picked) await changes.openDiff(picked.change);
  });

  registerCommand(subscriptions, 'dsh.openChange', async (change: FileChange) => {
    if (change?.relPath) await changes.openDiff(change);
  });

  registerCommand(subscriptions, 'dsh.revertChange', async (change: FileChange) => {
    if (!change?.relPath) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Revert "${change.relPath}" to the baseline version?`,
      { modal: true },
      'Revert',
    );
    if (confirmed !== 'Revert') return;

    const ok = await changes.revert(change);
    if (!ok) {
      void vscode.window.showErrorMessage(
        'Revert failed: no baseline content is available (delete new files manually).',
      );
      return;
    }
    await trees.changes.load();
    await context.syncChanges();
  });

  registerCommand(subscriptions, 'dsh.refreshChanges', async () => {
    await trees.changes.load();
    await context.syncChanges();
  });

  registerCommand(subscriptions, 'dsh.resetBaseline', async () => {
    const confirmed = await vscode.window.showWarningMessage(
      'Reset the baseline to the current state? Pending changes will no longer be listed.',
      { modal: true },
      'Reset',
    );
    if (confirmed !== 'Reset') return;
    await changes.resetBaseline();
    await trees.changes.load();
    await context.syncChanges();
  });

  registerCommand(subscriptions, 'dsh.addWhitelistFile', async () => {
    await addWhitelist(context, 'file');
  });

  registerCommand(subscriptions, 'dsh.addWhitelistFolder', async () => {
    await addWhitelist(context, 'folder');
  });

  registerCommand(subscriptions, 'dsh.removeWhitelist', async () => {
    const patterns = changes.whitelistPatterns;
    if (!patterns.length) {
      void vscode.window.showInformationMessage('The exclusion list is empty.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      patterns.map((pattern) => ({ label: pattern })),
      { canPickMany: true, title: 'Remove entries from the exclusion list' },
    );
    if (!picked?.length) return;

    const drop = new Set(picked.map((item) => item.label));
    const remaining = await changes.setWhitelist(patterns.filter((pattern) => !drop.has(pattern)));
    await trees.changes.load();
    void vscode.window.showInformationMessage(`Removed ${drop.size} entries; ${remaining.length} remain.`);
  });
}

async function addWhitelist(context: CommandContext, kind: 'file' | 'folder'): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: kind === 'file',
    canSelectFolders: kind === 'folder',
    canSelectMany: true,
    defaultUri: root,
    openLabel: 'Exclude from change tracking',
  });
  if (!picked?.length) return;

  const additions: string[] = [];
  let outside = 0;
  for (const uri of picked) {
    const relPath = relative(root.fsPath, uri.fsPath).split('\\').join('/');
    if (!relPath || relPath.startsWith('..')) {
      outside += 1;
      continue;
    }
    additions.push(relPath);
  }
  if (!additions.length) {
    void vscode.window.showWarningMessage('The selected paths are outside the workspace.');
    return;
  }

  const before = new Set(context.changes.whitelistPatterns);
  const next = await context.changes.setWhitelist([...before, ...additions]);
  await context.trees.changes.load();
  await context.syncChanges();
  void vscode.window.showInformationMessage(
    `Excluded ${additions.length} path(s)` +
      (outside ? `; ${outside} outside the workspace were skipped` : '') +
      ` (${next.length} entries total).`,
  );
}
