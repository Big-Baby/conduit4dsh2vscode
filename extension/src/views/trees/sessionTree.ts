import * as vscode from 'vscode';
import type { ProjectInfo, SessionInfo } from '@conduit4dsh2vscode/protocol';
import type { SessionService } from '../../core/session-service';
import { relativeTime } from '../../util/format';
import { BaseTree } from './base';

export class SessionTreeProvider extends BaseTree<SessionInfo> {
  private project: ProjectInfo | undefined;
  private sessions: SessionInfo[] = [];

  constructor(private readonly service: SessionService) {
    super();
  }

  setProject(project: ProjectInfo): void {
    this.project = project;
    this.refresh();
  }

  get currentSessions(): SessionInfo[] {
    return this.sessions;
  }

  async load(): Promise<void> {
    if (!this.project) {
      this.sessions = [];
      this.refresh();
      return;
    }
    try {
      this.sessions = await this.service.list(this.project.id, true);
    } catch {
      this.sessions = [];
    }
    this.refresh();
  }

  getChildren(element?: SessionInfo): SessionInfo[] {
    return element ? [] : this.sessions;
  }

  getTreeItem(session: SessionInfo): vscode.TreeItem {
    const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
    item.id = session.id;
    item.contextValue = 'session';
    item.description = [
      session.archived ? 'archived' : '',
      session.status === 'running' ? 'running' : '',
      relativeTime(session.updatedAt),
    ]
      .filter(Boolean)
      .join(' · ');
    item.tooltip = `${session.title}\n${session.id}\nUpdated ${relativeTime(session.updatedAt)}`;
    item.iconPath = new vscode.ThemeIcon(
      session.status === 'running' ? 'loading~spin' : session.archived ? 'archive' : 'comment-discussion',
    );
    item.command = { command: 'dsh.openSession', title: 'Open session', arguments: [session] };
    return item;
  }
}
