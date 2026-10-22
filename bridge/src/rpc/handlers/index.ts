import type { MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { ProjectService } from '../../core/project-service';
import type { SessionService } from '../../core/session-service';
import type { SettingsService } from '../../core/settings-service';
import type { WorkspaceFiles } from '../../core/workspace-files';
import type { ModelService } from '../../core/model-service';
import type { PermissionService } from '../../core/permission-service';
import type { PluginAdmin } from '../../dsh/plugins';
import { agentHandlers } from './agent';
import { configHandlers, type ConfigContext } from './config';
import { fileHandlers } from './file';
import { modelHandlers } from './model';
import { permissionHandlers } from './permission';
import { pluginHandlers } from './plugin';
import { sessionHandlers } from './session';
import { systemHandlers, type SystemContext } from './system';
import { workspaceHandlers } from './workspace';

export interface HandlerDeps {
  projects: ProjectService;
  sessions: SessionService;
  models: ModelService;
  files: WorkspaceFiles;
  settings: SettingsService;
  plugins: PluginAdmin;
  permissions: PermissionService;
  system: SystemContext;
  config: ConfigContext;
}

/**
 * Assembles the complete handler table.
 *
 * The return type is `MethodHandlers`; adding a method to the protocol breaks
 * this function until the method is implemented.
 */
export function createHandlers(deps: HandlerDeps): MethodHandlers {
  return {
    ...systemHandlers(deps.system),
    ...workspaceHandlers(deps.projects),
    ...sessionHandlers(deps.sessions, deps.files),
    ...modelHandlers(deps.models),
    ...agentHandlers(deps.sessions),
    ...fileHandlers(deps.files),
    ...pluginHandlers(deps.plugins),
    ...permissionHandlers(deps.permissions),
    ...configHandlers(deps.settings, deps.config),
  };
}
