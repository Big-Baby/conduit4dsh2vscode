import * as vscode from 'vscode';
import type { AgentInfo, SessionInfo } from '@conduit4dsh2vscode/protocol';
import { registerCommands } from './commands';
import type { CommandContext } from './commands/context';
import { AgentService } from './core/agent-service';
import { ChangeTracker } from './core/changes/tracker';
import { ConnectionService } from './core/connection';
import { ModelService } from './core/model-service';
import { PluginService } from './core/plugin-service';
import { SessionService } from './core/session-service';
import { ChatPanel } from './views/host/chatPanel';
import { AgentTreeProvider } from './views/trees/agentTree';
import { ChangesTreeProvider } from './views/trees/changesTree';
import { ModelTreeProvider } from './views/trees/modelTree';
import { PluginTreeProvider } from './views/trees/pluginTree';
import { SessionTreeProvider } from './views/trees/sessionTree';

interface Runtime {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  statusBar: vscode.StatusBarItem;
  tracker: ChangeTracker;
  changes: ChangeTracker;
  connection: ConnectionService;
  sessions: SessionService;
  models: ModelService;
  agents: AgentService;
  plugins: PluginService;
  trees: CommandContext['trees'];
  chat: {
    connection: ConnectionService;
    sessions: SessionService;
    models: ModelService;
    agents: AgentService;
  };
}

let runtime: Runtime | undefined;
let pendingChanges = 0;
let runningAgents = 0;
let agentRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let modelRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DSH', { log: true });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'dsh.connect';
  statusBar.text = '$(plug) DSH';
  statusBar.tooltip = 'Connect to DSH';
  statusBar.show();
  context.subscriptions.push(output, statusBar);

  const tracker = new ChangeTracker(context, output);
  tracker.startWatching();
  context.subscriptions.push(tracker);

  const connection = new ConnectionService(context, output);
  const sessions = new SessionService(() => connection.requireClient());
  const models = new ModelService(() => connection.requireClient());
  const agents = new AgentService(() => connection.requireClient());
  const plugins = new PluginService(() => connection.requireClient());

  const trees = {
    sessions: new SessionTreeProvider(sessions),
    models: new ModelTreeProvider(models),
    agents: new AgentTreeProvider(agents),
    plugins: new PluginTreeProvider(plugins),
    changes: new ChangesTreeProvider(tracker),
  };

  const chat = { connection, sessions, models, agents };

  const commandContext: CommandContext = {
    extensionUri: context.extensionUri,
    output,
    connection,
    sessions,
    models,
    agents,
    plugins,
    changes: tracker,
    trees,
    openChat: (session) => openChat(session),
    refreshModels: () => refreshModelState(),
    syncChanges: () => syncChanges(),
  };

  runtime = {
    extensionUri: context.extensionUri,
    output,
    statusBar,
    tracker,
    changes: tracker,
    connection,
    sessions,
    models,
    agents,
    plugins,
    trees,
    chat,
  };

  context.subscriptions.push(
    connection,
    trees.sessions,
    trees.models,
    trees.agents,
    trees.plugins,
    trees.changes,
    vscode.window.registerTreeDataProvider('dsh-sessions', trees.sessions),
    vscode.window.registerTreeDataProvider('dsh-models', trees.models),
    vscode.window.registerTreeDataProvider('dsh-agents', trees.agents),
    vscode.window.registerTreeDataProvider('dsh-plugins', trees.plugins),
    vscode.window.registerTreeDataProvider('dsh-changes', trees.changes),
  );

  connection.onClientCreated((client) => {
    context.subscriptions.push(
      client.on('session.event', (params) => {
        const { sessionId } = params as { sessionId: string };
        if (connection.session && sessionId !== connection.session.id) return;
        scheduleAgentRefresh();
      }),
      client.on('session.status', (params) => {
        const { sessionId, status } = params as { sessionId: string; status: string };
        if (connection.session && sessionId !== connection.session.id) return;
        scheduleAgentRefresh();
        if (status === 'idle' || status === 'error') void syncChanges();
      }),
      client.on('agent.event', (params) => {
        const { sessionId, agent } = params as { sessionId: string; agent: AgentInfo };
        if (connection.session && sessionId !== connection.session.id) return;
        void trees.agents.load().then(() => {
          runningAgents = agents.countRunning(trees.agents.rootsValue);
          renderStatus();
        });
        ChatPanel.postAgentAll(agent);
      }),
      client.on('model.changed', () => refreshModelState(60)),
      client.on('plugin.event', () => void trees.plugins.load()),
    );
  });

  connection.onDidChange((snapshot) => {
    if (snapshot.state === 'ready' && snapshot.project) {
      trees.sessions.setProject(snapshot.project);
      trees.agents.setSession(snapshot.session);
      void refreshAll();
    }
    renderStatus();
  });

  registerCommands(commandContext, context.subscriptions, connect);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dsh.providerConfig')) {
        void models.syncFromSettings().then(() => refreshModelState());
        return;
      }
      if (event.affectsConfiguration('dsh.ui')) {
        ChatPanel.postThemeAll();
        ChatPanel.postPrefsAll();
        return;
      }
      if (event.affectsConfiguration('dsh.changes')) {
        tracker.invalidate();
        void trees.changes.load();
        void syncChanges();
        return;
      }
      if (event.affectsConfiguration('dsh')) void restart();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => ChatPanel.postThemeAll()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (vscode.workspace.getConfiguration('dsh').get<boolean>('autoConnect', true)) void connect();
    }),
  );

  void vscode.commands.executeCommand('setContext', 'dsh.connected', false);
  void syncChanges();

  const config = vscode.workspace.getConfiguration('dsh');
  if (config.get<boolean>('autoConnect', true) && vscode.workspace.workspaceFolders?.length) {
    void connect();
  }
}

export async function deactivate(): Promise<void> {
  runtime?.connection.dispose();
  runtime = undefined;
}

/* ------------------------------ connection ------------------------------ */

async function connect(): Promise<void> {
  const current = runtime;
  if (!current) return;

  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before connecting to DSH.');
    return;
  }

  current.statusBar.text = '$(loading~spin) DSH';
  current.statusBar.tooltip = 'Connecting to DSH…';

  try {
    await current.connection.connect();
    await refreshAll();

    const synced = await current.models.syncFromSettings();
    for (const warning of synced?.warnings ?? []) current.output.appendLine(`[providerConfig] ${warning}`);
    if (synced) refreshModelState();

    renderStatus();
    if (vscode.workspace.getConfiguration('dsh').get<boolean>('autoOpenChat', false)) {
      const session = current.connection.session;
      if (session) openChat(session);
    }
  } catch (error) {
    renderStatus();
    const message = (error as Error).message;
    current.output.appendLine(`[connect] ${message}`);

    const actions = ['Show log'];
    if (/ENOENT|CLI not found|npx/i.test(message)) actions.push('Install DSH');
    const choice = await vscode.window.showErrorMessage(`Connecting to DSH failed: ${message}`, ...actions);
    if (choice === 'Show log') current.output.show();
    if (choice === 'Install DSH') void vscode.commands.executeCommand('dsh.installCli');
  }
}

async function restart(): Promise<void> {
  const current = runtime;
  if (!current) return;
  await current.connection.restart().catch((error: Error) => {
    current.output.appendLine(`[restart] ${error.message}`);
  });
  await refreshAll();
}

async function refreshAll(): Promise<void> {
  const current = runtime;
  if (!current) return;

  await current.trees.sessions.load();
  await current.trees.models.load();
  await current.trees.agents.load();
  if (current.connection.hasCapability('plugin-management')) await current.trees.plugins.load();
  await current.trees.changes.load();
  await syncChanges();

  runningAgents = current.agents.countRunning(current.trees.agents.rootsValue);
  renderStatus();
}

/* ------------------------------ chat ------------------------------ */

function openChat(session: SessionInfo): void {
  const current = runtime;
  if (!current) return;

  current.connection.setSession(session);
  current.trees.agents.setSession(session);
  void current.trees.agents.load();

  ChatPanel.createOrShow(current.extensionUri, current.chat, session, {
    onNewEntry: () => void vscode.commands.executeCommand('dsh.newSession'),
    onConfirmChanges: () => void vscode.commands.executeCommand('dsh.confirmChanges'),
    onCompareCode: () => void vscode.commands.executeCommand('dsh.compareCode'),
  });
}

/* ------------------------------ status ------------------------------ */

function renderStatus(): void {
  const current = runtime;
  if (!current) return;

  const connection = current.connection;
  const snapshot = connection.snapshot;

  if (snapshot.state === 'ready') {
    const mode = snapshot.info?.mode === 'live' ? '' : ' · replay';
    current.statusBar.text = `$(check) DSH${mode}`;
    current.statusBar.command = 'dsh.refreshSessions';
    current.statusBar.tooltip = snapshot.session
      ? `DSH connected · ${snapshot.session.title}${mode}`
      : 'DSH connected';
  } else if (snapshot.state === 'connecting' || snapshot.state === 'reconnecting') {
    current.statusBar.text = '$(loading~spin) DSH';
    current.statusBar.command = undefined;
    current.statusBar.tooltip = 'Connecting to DSH…';
  } else {
    current.statusBar.text = '$(plug) DSH';
    current.statusBar.command = 'dsh.connect';
    current.statusBar.tooltip = 'Connect to DSH';
  }

  const extras: string[] = [];
  if (pendingChanges > 0) extras.push(`${pendingChanges} pending change(s)`);
  if (runningAgents > 0) extras.push(`${runningAgents} agent(s) running`);
  if (extras.length) current.statusBar.text += ` · ${extras.join(' · ')}`;
}

/* ------------------------------ change tracking ------------------------------ */

async function syncChanges(): Promise<void> {
  const current = runtime;
  if (!current) return;

  try {
    const summary = await current.changes.summary();
    pendingChanges = summary.total;
    ChatPanel.postChangesAll(summary.total, summary.confirmedAt);
  } catch {
    pendingChanges = 0;
  }
  renderStatus();
}

/* ------------------------------ debounced refreshes ------------------------------ */

function scheduleAgentRefresh(): void {
  if (agentRefreshTimer) clearTimeout(agentRefreshTimer);
  agentRefreshTimer = setTimeout(() => {
    const current = runtime;
    if (!current) return;
    void current.trees.agents.load().then(() => {
      runningAgents = current.agents.countRunning(current.trees.agents.rootsValue);
      renderStatus();
    });
  }, 400);
}

function refreshModelState(delay = 0): void {
  if (modelRefreshTimer) clearTimeout(modelRefreshTimer);
  modelRefreshTimer = setTimeout(() => {
    const current = runtime;
    if (!current) return;
    void current.trees.models.load();
    void ChatPanel.refreshProviders(current.models);
  }, delay);
}
