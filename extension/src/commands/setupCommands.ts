import * as vscode from 'vscode';
import { ChatPanel } from '../views/host/chatPanel';
import { registerCommand } from './register';

export function registerSetupCommands(
  subscriptions: vscode.Disposable[],
  connect: () => Promise<void>,
): void {
  registerCommand(subscriptions, 'dsh.connect', connect);

  registerCommand(subscriptions, 'dsh.installCli', async () => {
    const terminal = vscode.window.createTerminal('DSH install');
    terminal.show();
    terminal.sendText('npm install -g @deepseek-ai/dsh');
    void vscode.window.showInformationMessage(
      'Installing the DSH CLI. When it finishes, run "DSH: Connect".',
    );
  });

  registerCommand(subscriptions, 'dsh.openUiSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'dsh.ui');
  });

  registerCommand(subscriptions, 'dsh.collapseAll', async () => {
    ChatPanel.setAllCollapsed(true);
  });

  registerCommand(subscriptions, 'dsh.expandAll', async () => {
    ChatPanel.setAllCollapsed(false);
  });
}
