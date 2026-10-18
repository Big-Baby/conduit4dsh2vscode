import * as vscode from 'vscode';
import type { SessionInfo } from '@conduit4dsh2vscode/protocol';
import type { CommandContext } from './context';
import { registerCommand } from './register';

export function registerSessionCommands(
  context: CommandContext,
  subscriptions: vscode.Disposable[],
): void {
  const { connection, sessions, trees } = context;

  registerCommand(subscriptions, 'dsh.openSession', async (session: SessionInfo) => {
    if (session?.id) context.openChat(session);
  });

  registerCommand(subscriptions, 'dsh.newSession', async () => {
    const project = connection.project;
    if (!project) return;

    const title = await vscode.window.showInputBox({
      prompt: 'Session title',
      value: 'New conversation',
      ignoreFocusOut: true,
    });
    const session = await sessions.create(project.id, title?.trim() || 'New conversation');
    await trees.sessions.load();
    context.openChat(session);
  });

  registerCommand(subscriptions, 'dsh.renameSession', async (session: SessionInfo) => {
    if (!session?.id) return;
    const title = await vscode.window.showInputBox({
      prompt: 'Rename session',
      value: session.title,
      ignoreFocusOut: true,
    });
    if (!title?.trim()) return;
    await sessions.rename(session.id, title.trim());
    await trees.sessions.load();
  });

  registerCommand(subscriptions, 'dsh.forkSession', async (session: SessionInfo) => {
    if (!session?.id) return;
    const forked = await sessions.fork(session.id);
    await trees.sessions.load();
    context.openChat(forked);
  });

  registerCommand(subscriptions, 'dsh.archiveSession', async (session: SessionInfo) => {
    if (!session?.id) return;
    await sessions.archive(session.id);
    await trees.sessions.load();
  });

  registerCommand(subscriptions, 'dsh.unarchiveSession', async (session: SessionInfo) => {
    if (!session?.id) return;
    await sessions.unarchive(session.id);
    await trees.sessions.load();
  });

  registerCommand(subscriptions, 'dsh.deleteSession', async (session: SessionInfo) => {
    if (!session?.id) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${session.title}"? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;
    await sessions.remove(session.id);
    await trees.sessions.load();
  });

  registerCommand(subscriptions, 'dsh.copySessionId', async (session: SessionInfo) => {
    if (!session?.id) return;
    await vscode.env.clipboard.writeText(session.id);
    void vscode.window.showInformationMessage(`Session id copied: ${session.id}`);
  });

  registerCommand(subscriptions, 'dsh.refreshSessions', async () => {
    await trees.sessions.load();
  });
}
