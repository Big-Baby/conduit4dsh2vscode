import * as vscode from 'vscode';
import {
  type AgentNode,
  type DefaultModelSelection,
  type PermissionState,
  type ProviderInfo,
  type SessionEvent,
  type SessionInfo,
} from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../../rpc/client';
import type { AgentService } from '../../core/agent-service';
import type { ConnectionService } from '../../core/connection';
import type { ModelService } from '../../core/model-service';
import type { PermissionService } from '../../core/permission-service';
import type { SessionService } from '../../core/session-service';
import { buildPalette, buildPreferences } from '../theme/palette';
import type { OutboundMessage } from '../chat/types';
import { DIAGNOSTIC_BOOTSTRAP, inlineAsset, renderHtml } from './html';

export interface ChatPanelServices {
  connection: ConnectionService;
  sessions: SessionService;
  models: ModelService;
  agents: AgentService;
  permissions: PermissionService;
}

export interface ChatPanelCallbacks {
  onNewEntry: (session: SessionInfo) => void;
  onConfirmChanges: () => void;
  onCompareCode: () => void;
}

/** First page size: fast first paint on long conversations. */
const PAGE_SIZE = 20;

/**
 * Chat panel, one per session.
 *
 * The host owns pagination cursors, provider snapshots and running state; the
 * page only renders what it receives.
 */
export class ChatPanel {
  private static readonly panels = new Map<string, ChatPanel>();

  static createOrShow(
    extensionUri: vscode.Uri,
    services: ChatPanelServices,
    session: SessionInfo,
    callbacks: ChatPanelCallbacks,
  ): ChatPanel {
    const existing = ChatPanel.panels.get(session.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel('dshChat', session.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'chat')],
    });

    const instance = new ChatPanel(panel, extensionUri, services, session, callbacks);
    ChatPanel.panels.set(session.id, instance);
    return instance;
  }

  static async reloadAll(): Promise<void> {
    await Promise.all([...ChatPanel.panels.values()].map((panel) => panel.loadSnapshot()));
  }

  static postChangesAll(total: number, confirmedAt?: string): void {
    for (const panel of ChatPanel.panels.values()) {
      panel.post({ type: 'changes', total, confirmedAt: confirmedAt ?? '' });
    }
  }

  static postThemeAll(): void {
    const palette = buildPalette();
    for (const panel of ChatPanel.panels.values()) panel.post({ type: 'theme', palette });
  }

  static postPrefsAll(): void {
    const preferences = buildPreferences();
    for (const panel of ChatPanel.panels.values()) panel.post({ type: 'prefs', prefs: preferences });
  }

  static postProvidersAll(providers: ProviderInfo[], defaultModelId?: string): void {
    for (const panel of ChatPanel.panels.values()) {
      panel.post({
        type: 'providers',
        providers,
        ...(defaultModelId === undefined ? {} : { defaultModelId }),
      });
    }
  }

  /** Pulls a fresh provider snapshot; failures keep the previous list. */
  static async refreshProviders(models: ModelService): Promise<void> {
    try {
      const [providers, selection] = await Promise.all([
        models.providers(),
        models.getDefault().catch((): DefaultModelSelection => ({})),
      ]);
      ChatPanel.postProvidersAll(providers, selection.modelId ?? '');
    } catch (error) {
      console.log(`[dsh-chat] provider refresh failed: ${(error as Error).message}`);
    }
  }

  static setAllCollapsed(collapsed: boolean): void {
    for (const panel of ChatPanel.panels.values()) panel.post({ type: 'collapseAll', collapsed });
  }

  static postAgentAll(agent: unknown): void {
    for (const panel of ChatPanel.panels.values()) panel.post({ type: 'agent', agent });
  }

  /** Pushes a permission snapshot to every open transcript. */
  static postPermissionAll(permission: PermissionState): void {
    for (const panel of ChatPanel.panels.values()) panel.post({ type: 'permission', permission });
  }

  private readonly disposables: vscode.Disposable[] = [];
  private clientBindings: vscode.Disposable[] = [];
  private session: SessionInfo;
  private running = false;
  private oldestMessageId: string | undefined;
  private hasMoreHistory = false;
  private historyTotal = 0;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly services: ChatPanelServices,
    session: SessionInfo,
    private readonly callbacks: ChatPanelCallbacks,
  ) {
    this.session = session;
    this.panel.webview.html = this.render();
    this.panel.webview.onDidReceiveMessage(
      (message: OutboundMessage) => void this.handle(message),
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);

    this.bindClient();
    this.disposables.push(
      this.services.connection.onDidChange((snapshot) => {
        if (snapshot.state !== 'ready') return;
        this.bindClient();
        void this.loadSnapshot();
      }),
    );
  }

  /**
   * Attaches to the current client.
   *
   * The connection may be recreated (configuration change, reconnect), so the
   * bindings are disposable and re-established instead of captured once.
   */
  private bindClient(): void {
    for (const binding of this.clientBindings) binding.dispose();
    this.clientBindings = [];

    let client: DshClient;
    try {
      client = this.services.connection.requireClient();
    } catch {
      return;
    }

    client.subscribeSession(this.session.id);
    this.clientBindings.push(
      client.on('session.event', (params) => {
        const { sessionId, event } = params as { sessionId: string; event: SessionEvent };
        if (sessionId !== this.session.id) return;
        this.post({ type: 'event', event });

        // Only root events end the turn; sub-agent events arrive while the main
        // agent is still working.
        const isRoot = !event.agent || event.agent.id === 'root';
        if (!isRoot) return;
        if (event.type === 'assistant.message' || event.type === 'error' || event.type === 'tool.result') {
          this.setRunning(false);
        }
      }),
      client.on('session.status', (params) => {
        const { sessionId, status } = params as { sessionId: string; status: string };
        if (sessionId !== this.session.id) return;
        this.post({ type: 'state', status });
        this.setRunning(status === 'running');
      }),
      client.on('agent.event', (params) => {
        const { sessionId, agent } = params as { sessionId: string; agent: unknown };
        if (sessionId !== this.session.id) return;
        this.post({ type: 'agent', agent });
      }),
      client.on('permission.changed', (params) => {
        const { sessionId } = params as { sessionId?: string };
        if (sessionId && sessionId !== this.session.id) return;
        void this.services.permissions
          .get(this.session.id)
          .then((permission) => this.post({ type: 'permission', permission }))
          .catch(() => undefined);
      }),
    );
  }

  /** Reloads the snapshot; used by reconnect and external session changes. */
  async loadSnapshot(): Promise<void> {
    try {
      const [detail, providers, selection, agents, info, permission] = await Promise.all([
        this.services.sessions.get(this.session.id),
        this.services.models.providers().catch(() => [] as ProviderInfo[]),
        this.services.models.getDefault().catch((): DefaultModelSelection => ({})),
        this.services.agents.tree(this.session.id).catch(() => [] as AgentNode[]),
        this.services.connection
          .requireClient()
          .request<{ mode?: 'live' | 'replay' }>('system.info')
          .catch((): { mode?: 'live' | 'replay' } => ({})),
        this.services.permissions
          .get(this.session.id)
          .catch((): PermissionState => ({ available: false, options: [] })),
      ]);

      this.session = detail.session;
      this.panel.title = detail.session.title;

      const page = detail.messages.slice(-PAGE_SIZE);
      this.oldestMessageId = page[0]?.id;
      this.hasMoreHistory = Boolean(this.oldestMessageId) && detail.messages.length > PAGE_SIZE;
      this.historyTotal = detail.messages.length;

      this.post({
        type: 'snapshot',
        session: detail.session,
        messages: page,
        providers,
        modelId: selection.modelId ?? '',
        ...(selection.effort ? { effort: selection.effort } : {}),
        agents,
        hasMoreHistory: this.hasMoreHistory,
        historyTotal: this.historyTotal,
        permission,
      });
      this.post({ type: 'theme', palette: buildPalette() });
      this.post({ type: 'prefs', prefs: buildPreferences() });
      this.post({ type: 'serverMode', mode: info.mode === 'live' ? 'live' : 'replay' });
    } catch (error) {
      this.post({ type: 'error', message: (error as Error).message });
    }
  }

  private render(): string {
    const style = inlineAsset(this.extensionUri, 'dist', 'chat', 'dsh-chat.css');
    const script = inlineAsset(this.extensionUri, 'dist', 'chat', 'dsh-chat.js');
    return renderHtml({
      webview: this.panel.webview,
      title: 'DSH',
      body: '<div id="app"></div>',
      style,
      bootstrap: DIAGNOSTIC_BOOTSTRAP,
      ...(script
        ? { script }
        : {
            script: "window.__dshFatal('[dsh] chat bundle is missing: dist/chat/dsh-chat.js');",
          }),
    });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    this.post({ type: 'state', status: running ? 'running' : 'idle' });
  }

  private async handle(message: OutboundMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.loadSnapshot();
        break;

      case 'history':
        await this.loadEarlier();
        break;

      case 'send': {
        if (this.running || !message.text.trim()) return;
        this.setRunning(true);
        try {
          await this.services.sessions.append(
            this.session.id,
            message.text,
            (message.mentions ?? []).map((mention) => ({
              kind: 'file' as const,
              path: mention.path,
              ...(mention.name ? { name: mention.name } : {}),
            })),
          );
        } catch (error) {
          this.setRunning(false);
          this.post({ type: 'error', message: (error as Error).message });
        }
        break;
      }

      case 'stop':
        try {
          await this.services.sessions.cancel(this.session.id);
        } finally {
          this.setRunning(false);
        }
        break;

      case 'cancelAgent':
        try {
          await this.services.agents.cancel(this.session.id, message.agentId);
        } catch (error) {
          this.post({ type: 'error', message: (error as Error).message });
        }
        break;

      case 'setPermission':
        try {
          const permission = await this.services.permissions.set(this.session.id, message.preset);
          this.post({ type: 'permission', permission });
        } catch (error) {
          this.post({ type: 'error', message: (error as Error).message });
        }
        break;

      case 'listFiles':
        try {
          const files = await this.services.connection
            .requireClient()
            .request<{ files: unknown[]; truncated?: boolean }>('file.list');
          this.post({ type: 'fileList', files: files.files ?? [], truncated: Boolean(files.truncated) });
        } catch (error) {
          this.post({ type: 'fileList', files: [], error: (error as Error).message });
        }
        break;

      case 'setModel':
        try {
          await this.services.models.setDefault(message.modelId, this.session.id, message.effort);
        } catch (error) {
          this.post({ type: 'error', message: (error as Error).message });
        }
        break;

      case 'newEntry':
        this.callbacks.onNewEntry(this.session);
        break;

      case 'confirmChanges':
        this.callbacks.onConfirmChanges();
        break;

      case 'compareCode':
        this.callbacks.onCompareCode();
        break;

      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: 'copied' });
        break;

      case 'collapseAll':
      case 'expandAll':
        ChatPanel.setAllCollapsed(message.type === 'collapseAll' ? message.collapsed : false);
        break;

      case 'openUiSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'dsh.ui');
        break;

      case 'addProvider':
        await vscode.commands.executeCommand('dsh.addProvider');
        break;
    }
  }

  private async loadEarlier(): Promise<void> {
    if (!this.oldestMessageId || !this.hasMoreHistory) {
      this.hasMoreHistory = false;
      this.post({ type: 'historyPage', messages: [], hasMore: false, total: this.historyTotal });
      return;
    }

    try {
      const page = await this.services.sessions.history(this.session.id, this.oldestMessageId, PAGE_SIZE);
      const messages = page.messages;
      this.hasMoreHistory = page.hasMore && messages.length > 0;
      if (messages[0]) this.oldestMessageId = messages[0].id;
      this.historyTotal = page.total;
      this.post({ type: 'historyPage', messages, hasMore: this.hasMoreHistory, total: this.historyTotal });
    } catch (error) {
      const notFound = /method not found|-32601/i.test((error as Error).message);
      if (notFound) this.hasMoreHistory = false;
      this.post({
        type: 'historyPage',
        messages: [],
        hasMore: this.hasMoreHistory,
        total: this.historyTotal,
        error: notFound ? 'the bridge does not support history paging' : (error as Error).message,
      });
    }
  }

  private cleanup(): void {
    try {
      this.services.connection.client?.unsubscribeSession(this.session.id);
    } catch {
      /* the connection may already be gone */
    }
    for (const binding of this.clientBindings) binding.dispose();
    this.clientBindings = [];
    ChatPanel.panels.delete(this.session.id);
    for (const disposable of this.disposables) disposable.dispose();
  }
}
