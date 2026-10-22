import type * as vscode from 'vscode';
import type { SessionInfo } from '@conduit4dsh2vscode/protocol';
import type { AgentService } from '../core/agent-service';
import type { ChangeTracker } from '../core/changes/tracker';
import type { ConnectionService } from '../core/connection';
import type { ModelService } from '../core/model-service';
import type { PermissionService } from '../core/permission-service';
import type { PluginService } from '../core/plugin-service';
import type { SessionService } from '../core/session-service';
import type { AgentTreeProvider } from '../views/trees/agentTree';
import type { ChangesTreeProvider } from '../views/trees/changesTree';
import type { ModelTreeProvider } from '../views/trees/modelTree';
import type { PluginTreeProvider } from '../views/trees/pluginTree';
import type { SessionTreeProvider } from '../views/trees/sessionTree';

/**
 * Dependencies shared by all commands.
 *
 * Commands are the only layer allowed to touch both services and views; this
 * keeps UI calls out of the domain services and RPC code.
 */
export interface CommandContext {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  connection: ConnectionService;
  sessions: SessionService;
  models: ModelService;
  agents: AgentService;
  plugins: PluginService;
  permissions: PermissionService;
  changes: ChangeTracker;
  trees: {
    sessions: SessionTreeProvider;
    models: ModelTreeProvider;
    agents: AgentTreeProvider;
    plugins: PluginTreeProvider;
    changes: ChangesTreeProvider;
  };
  openChat: (session: SessionInfo) => void;
  refreshModels: () => void;
  refreshPermission: () => Promise<void>;
  syncChanges: () => Promise<void>;
}
