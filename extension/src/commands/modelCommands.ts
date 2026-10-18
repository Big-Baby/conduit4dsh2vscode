import * as vscode from 'vscode';
import type { ModelInfo, ProviderInfo } from '@conduit4dsh2vscode/protocol';
import { ProviderPanel } from '../views/host/providerPanel';
import type { CommandContext } from './context';
import { registerCommand } from './register';

export function registerModelCommands(context: CommandContext, subscriptions: vscode.Disposable[]): void {
  const { models, trees, output } = context;

  registerCommand(subscriptions, 'dsh.addProvider', async () => {
    ProviderPanel.createOrShow(context.extensionUri, models, () => context.refreshModels());
  });

  registerCommand(subscriptions, 'dsh.setApiKey', async (provider: ProviderInfo) => {
    if (!provider?.id) return;
    const apiKey = await vscode.window.showInputBox({
      prompt: `API key for ${provider.id}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) return;
    await models.setKey(provider.id, apiKey);
    context.refreshModels();
  });

  registerCommand(subscriptions, 'dsh.removeProvider', async (provider: ProviderInfo) => {
    if (!provider?.id) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Remove provider ${provider.id} and its stored key?`,
      { modal: true },
      'Remove',
    );
    if (confirmed !== 'Remove') return;
    await models.removeProvider(provider.id);
    context.refreshModels();
  });

  registerCommand(subscriptions, 'dsh.setDefaultModel', async (model: ModelInfo) => {
    if (!model?.id) return;
    await models.setDefault(model.id);
    context.refreshModels();
    void vscode.window.showInformationMessage(`Default model set to ${model.name || model.id}`);
  });

  registerCommand(subscriptions, 'dsh.refreshModels', async () => {
    context.refreshModels();
  });

  registerCommand(subscriptions, 'dsh.syncProviderConfig', async () => {
    const result = await models.syncFromSettings();
    if (!result) {
      void vscode.window.showInformationMessage('dsh.providerConfig is empty; nothing to sync.');
      return;
    }
    context.refreshModels();
    for (const warning of result.warnings) output.appendLine(`[providerConfig] ${warning}`);
    void vscode.window.showInformationMessage(
      `Synced ${result.providers} providers / ${result.models} models` +
        (result.warnings.length ? ` (${result.warnings.length} warnings in the DSH log)` : ''),
    );
    await trees.sessions.load();
  });
}
