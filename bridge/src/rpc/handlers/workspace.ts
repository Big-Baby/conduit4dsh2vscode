import type { MethodHandlers } from '@conduit4dsh2vscode/protocol';
import type { ProjectService } from '../../core/project-service';
import { requireString } from '../params';

export function workspaceHandlers(projects: ProjectService): Pick<
  MethodHandlers,
  'workspace.list' | 'project.list' | 'project.ensure' | 'project.remove'
> {
  return {
    'workspace.list': () =>
      projects.list().map((project) => ({ id: project.id, name: project.name, path: project.path })),

    'project.list': () => projects.list(),

    'project.ensure': (params) => projects.ensure(requireString(params, 'name'), requireString(params, 'path')),

    'project.remove': (params) => {
      projects.remove(requireString(params, 'projectId'));
      return { ok: true };
    },
  };
}
