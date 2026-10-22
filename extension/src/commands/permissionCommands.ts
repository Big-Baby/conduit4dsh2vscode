import * as vscode from 'vscode';
import type { CommandContext } from './context';
import { registerCommand } from './register';

interface PresetPick extends vscode.QuickPickItem {
  value: string;
}

/**
 * Permission switching.
 *
 * The presets themselves belong to the harness; this command only chooses one
 * and reports what changed. Escalating to full access is confirmed, because
 * that preset also switches the approval policy to `never` — after it, nothing
 * asks again.
 */
export function registerPermissionCommands(
  context: CommandContext,
  subscriptions: vscode.Disposable[],
): void {
  const { connection, permissions, output, refreshPermission } = context;

  registerCommand(subscriptions, 'dsh.setPermission', async (preset?: string) => {
    const session = connection.session;
    if (!session) {
      void vscode.window.showInformationMessage('Open a DSH session first.');
      return;
    }

    const state = await permissions.get(session.id);
    if (!state.available) {
      void vscode.window.showInformationMessage(
        'This DSH harness exposes no permission presets; update the bridge or the profile.',
      );
      return;
    }

    let target = typeof preset === 'string' && preset.trim() ? preset.trim() : undefined;
    if (!target) {
      const picks: PresetPick[] = state.options.map((option) => ({
        label: option.name,
        description: option.value === state.preset ? 'current' : option.value,
        ...(option.description ? { detail: option.description } : {}),
        value: option.value,
      }));
      if (!picks.length) {
        void vscode.window.showInformationMessage('No permission presets are configured.');
        return;
      }
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: `Permission for this session (now: ${state.preset ?? 'unknown'})`,
      });
      if (!picked) return;
      target = picked.value;
    }

    if (target === 'danger-full-access') {
      const confirmed = await vscode.window.showWarningMessage(
        'Switch this session to full access? The sandbox stops confining file writes and approvals stop asking.',
        { modal: true },
        'Use full access',
      );
      if (confirmed !== 'Use full access') return;
    }

    const next = await permissions.set(session.id, target);
    output.appendLine(
      `[permission] ${session.id} → ${next.preset ?? target}` +
        (next.sandbox ? ` (sandbox=${next.sandbox}, approval=${next.approval ?? '?'})` : ''),
    );
    await refreshPermission();
  });

  registerCommand(subscriptions, 'dsh.showPermission', async () => {
    const session = connection.session;
    if (!session) return;
    const state = await permissions.get(session.id);
    if (!state.available) {
      void vscode.window.showInformationMessage('This DSH harness exposes no permission presets.');
      return;
    }
    const lines = [
      `Session: ${session.title}`,
      `Preset: ${state.preset ?? 'unknown'}`,
      state.sandbox ? `Sandbox: ${state.sandbox}` : '',
      state.approval ? `Approval: ${state.approval}` : '',
      state.defaultPreset ? `Default for new sessions: ${state.defaultPreset}` : '',
      '',
      `Available: ${state.options.map((option) => option.value).join(', ') || 'none'}`,
    ].filter(Boolean);
    await vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  });
}
