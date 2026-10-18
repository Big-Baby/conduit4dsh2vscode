import { createId, nowIso, type ProjectInfo } from '@conduit4dsh2vscode/protocol';
import { JsonStore } from '../store/json-store';
import type { BridgePaths } from '../store/paths';
import type { SessionMetaStore } from './session-store';

/** Workspace registry owned by the bridge. */
export class ProjectService {
  private readonly store: JsonStore<ProjectInfo[]>;

  constructor(
    paths: BridgePaths,
    private readonly sessions: SessionMetaStore,
  ) {
    this.store = new JsonStore<ProjectInfo[]>(paths.projects, () => []);
  }

  list(): ProjectInfo[] {
    const counts = new Map<string, number>();
    for (const session of this.sessions.list()) {
      counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
    }
    return this.store
      .read()
      .filter((project) => typeof project.id === 'string' && typeof project.path === 'string')
      .map((project) => ({ ...project, sessionCount: counts.get(project.id) ?? 0 }));
  }

  /** Path wins over name: renaming a project must not create a second entry. */
  ensure(name: string, path: string): ProjectInfo {
    const projects = this.store.read();
    const existing = projects.find((project) => project.path === path) ?? projects.find((project) => project.name === name);
    if (existing) return { ...existing, sessionCount: this.countOf(existing.id) };

    const project: ProjectInfo = {
      id: createId('p'),
      name,
      path,
      createdAt: nowIso(),
      sessionCount: 0,
    };
    projects.push(project);
    this.store.write(projects);
    return project;
  }

  remove(projectId: string): void {
    this.store.write(this.store.read().filter((project) => project.id !== projectId));
    for (const session of this.sessions.list().filter((item) => item.projectId === projectId)) {
      this.sessions.remove(session.id);
    }
  }

  private countOf(projectId: string): number {
    return this.sessions.list().filter((session) => session.projectId === projectId).length;
  }
}
