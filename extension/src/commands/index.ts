import type * as vscode from 'vscode';
import { registerAgentCommands } from './agentCommands';
import { registerChangeCommands } from './changeCommands';
import type { CommandContext } from './context';
import { registerModelCommands } from './modelCommands';
import { registerPluginCommands } from './pluginCommands';
import { registerSessionCommands } from './sessionCommands';
import { registerSetupCommands } from './setupCommands';

export function registerCommands(
  context: CommandContext,
  subscriptions: vscode.Disposable[],
  connect: () => Promise<void>,
): void {
  registerSetupCommands(subscriptions, connect);
  registerSessionCommands(context, subscriptions);
  registerModelCommands(context, subscriptions);
  registerAgentCommands(context, subscriptions);
  registerChangeCommands(context, subscriptions);
  registerPluginCommands(context, subscriptions);
}
