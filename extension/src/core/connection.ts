import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { ProjectInfo, ServerInfo, SessionInfo } from '@conduit4dsh2vscode/protocol';
import { DshClient } from '../rpc/client';
import type { TransportOptions } from '../rpc/transport';

export type ConnectionState = 'disconnected' | 'connecting' | 'ready' | 'reconnecting';

export interface ConnectionSnapshot {
  state: ConnectionState;
  info?: ServerInfo;
  project?: ProjectInfo;
  session?: SessionInfo;
}

/**
 * Owns the RPC client and the workspace bootstrap sequence.
 *
 * `connect()` is idempotent: it creates the client once, then re-establishes
 * the project and session. Views observe `onDidChange` instead of polling.
 */
export class ConnectionService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ConnectionSnapshot>();
  private readonly clientEmitter = new vscode.EventEmitter<DshClient>();
  private clientValue: DshClient | undefined;
  private stateValue: ConnectionState = 'disconnected';
  private projectValue: ProjectInfo | undefined;
  private sessionValue: SessionInfo | undefined;
  private connecting: Promise<void> | undefined;
  private disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;
  /** Fires whenever a new client instance is created. */
  readonly onClientCreated = this.clientEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  get snapshot(): ConnectionSnapshot {
    return {
      state: this.stateValue,
      ...(this.clientValue?.info ? { info: this.clientValue.info } : {}),
      ...(this.projectValue ? { project: this.projectValue } : {}),
      ...(this.sessionValue ? { session: this.sessionValue } : {}),
    };
  }

  get client(): DshClient | undefined {
    return this.clientValue;
  }

  requireClient(): DshClient {
    if (!this.clientValue) throw new Error('DSH is not connected');
    return this.clientValue;
  }

  get project(): ProjectInfo | undefined {
    return this.projectValue;
  }

  get session(): SessionInfo | undefined {
    return this.sessionValue;
  }

  setSession(session: SessionInfo): void {
    this.sessionValue = session;
    this.fire();
  }

  hasCapability(name: string): boolean {
    return this.clientValue?.hasCapability(name) ?? false;
  }

  /**
   * Bootstrap, deduplicated across concurrent callers.
   *
   * Several triggers fire at once when a remote folder opens (auto-connect,
   * workspace-folder change, panel creation). Each bootstrap spawns a bridge and
   * creates a session when none is remembered yet, so without this lock a single
   * folder open produced several duplicate "New conversation" entries.
   */
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const run = this.runConnect().finally(() => {
      this.connecting = undefined;
    });
    this.connecting = run;
    return run;
  }

  private async runConnect(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a folder before connecting to DSH');

    this.setState('connecting');
    try {
      const client = this.ensureClient();
      const info = await client.connect();

      const project = await client.request<ProjectInfo>('project.ensure', {
        name: basename(folder.uri.fsPath) || 'workspace',
        path: folder.uri.fsPath,
      });
      const session = await this.restoreSession(client, project);
      this.projectValue = project;
      this.sessionValue = session;

      const key = this.sessionKey(project);
      await this.context.globalState.update(key, session.id);

      await vscode.commands.executeCommand('setContext', 'dsh.connected', true);
      await vscode.commands.executeCommand(
        'setContext',
        'dsh.multiAgent',
        info.capabilities.includes('multi-agent'),
      );
      await vscode.commands.executeCommand(
        'setContext',
        'dsh.pluginManagement',
        info.capabilities.includes('plugin-management'),
      );

      this.setState('ready');
      this.output.appendLine(
        `[bootstrap] project=${project.name} session=${session.title} mode=${info.mode}`,
      );
    } catch (error) {
      this.setState('disconnected');
      await vscode.commands.executeCommand('setContext', 'dsh.connected', false);
      throw error;
    }
  }

  async restart(): Promise<void> {
    const pending = this.connecting;
    if (pending) await pending.catch(() => undefined);
    this.disposeClient();
    await this.connect();
  }

  dispose(): void {
    this.disposeClient();
    this.changeEmitter.dispose();
    this.clientEmitter.dispose();
  }

  /* ------------------------------ internals ------------------------------ */

  private ensureClient(): DshClient {
    if (this.clientValue) return this.clientValue;

    const config = vscode.workspace.getConfiguration('dsh');
    const folder = vscode.workspace.workspaceFolders?.[0];
    const options: TransportOptions = {
      kind: config.get<'stdio' | 'tcp' | 'unix'>('transport', 'stdio'),
      cliPath: config.get<string>('cliPath', ''),
      home: config.get<string>('home', ''),
      profile: config.get<string>('profile', 'rpc'),
      cwd: folder?.uri.fsPath ?? process.cwd(),
      permissionMode: config.get<string>('permissionMode', 'workspace-write'),
      liveAgentLoop: config.get<boolean>('enableLiveAgentLoop', true),
      host: config.get<string>('rpcHost', '127.0.0.1'),
      port: config.get<number>('rpcPort', 4113),
      socketPath: config.get<string>('rpcSocketPath', ''),
      token: config.get<string>('rpcToken', ''),
    };

    const client = new DshClient(options, this.output);
    this.clientValue = client;
    this.disposables.push(
      client.onState((state) => {
        if (state === 'reconnecting') this.setState('reconnecting');
        if (state === 'stopped') {
          this.setState('disconnected');
          void vscode.commands.executeCommand('setContext', 'dsh.connected', false);
        }
      }),
      client.onReconnected(() => {
        void this.recover();
      }),
    );
    this.clientEmitter.fire(client);
    return client;
  }

  /** After a reconnect the server may have restarted; re-run bootstrap. */
  private async recover(): Promise<void> {
    this.output.appendLine('[dsh] reconnected, re-running bootstrap');
    try {
      await this.connect();
    } catch (error) {
      this.output.appendLine(`[dsh] bootstrap after reconnect failed: ${(error as Error).message}`);
    }
  }

  private async restoreSession(client: DshClient, project: ProjectInfo): Promise<SessionInfo> {
    const key = this.sessionKey(project);
    const lastId = this.context.globalState.get<string>(key);
    const sessions = await client.request<SessionInfo[]>('session.list', {
      projectId: project.id,
      includeArchived: false,
    });

    if (lastId) {
      const remembered = sessions.find((session) => session.id === lastId);
      if (remembered) return remembered;
    }
    if (sessions[0]) return sessions[0];

    return client.request<SessionInfo>('session.create', {
      projectId: project.id,
      title: 'New conversation',
    });
  }

  private sessionKey(project: ProjectInfo): string {
    return `dsh.lastSession.${basename(project.path) || project.id}`;
  }

  private disposeClient(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    this.clientValue?.dispose();
    this.clientValue = undefined;
    this.projectValue = undefined;
    this.sessionValue = undefined;
  }

  private setState(state: ConnectionState): void {
    this.stateValue = state;
    this.fire();
  }

  private fire(): void {
    this.changeEmitter.fire(this.snapshot);
  }
}
