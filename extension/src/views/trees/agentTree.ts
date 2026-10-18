import * as vscode from 'vscode';
import type { AgentNode, SessionInfo } from '@conduit4dsh2vscode/protocol';
import type { AgentService } from '../../core/agent-service';
import { formatDuration } from '../../util/format';
import { BaseTree } from './base';

const STATUS_ICON: Record<string, string> = {
  running: 'loading~spin',
  pending: 'clock',
  waiting: 'watch',
  success: 'check',
  error: 'error',
  cancelled: 'circle-slash',
};

export class AgentTreeProvider extends BaseTree<AgentNode> {
  private session: SessionInfo | undefined;
  private roots: AgentNode[] = [];

  constructor(private readonly service: AgentService) {
    super();
  }

  setSession(session: SessionInfo | undefined): void {
    this.session = session;
    this.refresh();
  }

  async load(): Promise<void> {
    if (!this.session) {
      this.roots = [];
      this.refresh();
      return;
    }
    try {
      this.roots = await this.service.tree(this.session.id);
    } catch {
      this.roots = [];
    }
    this.refresh();
  }

  get rootsValue(): AgentNode[] {
    return this.roots;
  }

  getChildren(element?: AgentNode): AgentNode[] {
    return element ? element.children : this.roots;
  }

  getTreeItem(agent: AgentNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      agent.name || agent.id,
      agent.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `${agent.sessionId}:${agent.id}`;
    item.contextValue = agent.status === 'running' || agent.status === 'pending' ? 'agent-running' : 'agent';
    item.description = [
      agent.status,
      agent.toolCalls ? `${agent.toolCalls} tools` : '',
      formatDuration(agent.durationMs),
    ]
      .filter(Boolean)
      .join(' · ');
    item.tooltip = [
      `${agent.name} (${agent.id})`,
      agent.task ? `task: ${agent.task}` : '',
      agent.lastText ? `last: ${agent.lastText.slice(0, 200)}` : '',
      agent.error ? `error: ${agent.error}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    item.iconPath = new vscode.ThemeIcon(STATUS_ICON[agent.status] ?? 'circle-outline');
    item.command = { command: 'dsh.showAgent', title: 'Show details', arguments: [agent] };
    return item;
  }
}
