import * as vscode from 'vscode';
import type { AgentNode } from '@conduit4dsh2vscode/protocol';
import { formatDuration } from '../util/format';
import type { CommandContext } from './context';
import { registerCommand } from './register';

export function registerAgentCommands(context: CommandContext, subscriptions: vscode.Disposable[]): void {
  const { agents, connection, trees } = context;

  registerCommand(subscriptions, 'dsh.showAgent', async (agent: AgentNode) => {
    if (!agent?.id) return;
    const lines = [
      `${agent.name} (${agent.id})`,
      `role: ${agent.kind}${agent.role ? ` / ${agent.role}` : ''}`,
      `status: ${agent.status}`,
      agent.task ? `task: ${agent.task}` : '',
      `tools: ${agent.toolCalls} · messages: ${agent.messageCount}`,
      `started: ${agent.startedAt}`,
      agent.endedAt ? `ended: ${agent.endedAt}` : '',
      agent.durationMs !== undefined ? `duration: ${formatDuration(agent.durationMs)}` : '',
      agent.error ? `error: ${agent.error}` : '',
      agent.lastText ? `last output:\n${agent.lastText.slice(0, 800)}` : '',
    ].filter(Boolean);
    await vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  });

  registerCommand(subscriptions, 'dsh.cancelAgent', async (agent: AgentNode) => {
    const session = connection.session;
    if (!agent?.id || !session) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Cancel agent "${agent.name}"?`,
      { modal: true },
      'Cancel agent',
    );
    if (confirmed !== 'Cancel agent') return;
    await agents.cancel(session.id, agent.id);
    await trees.agents.load();
  });

  registerCommand(subscriptions, 'dsh.refreshAgents', async () => {
    await trees.agents.load();
  });
}
