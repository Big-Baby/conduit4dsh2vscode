import type { SessionInfo } from '@conduit4dsh2vscode/protocol';
import { JsonStore } from '../store/json-store';
import type { BridgePaths } from '../store/paths';

/**
 * Bridge-owned session metadata.
 *
 * The harness stores the conversation; project assignment, display title and
 * the archive flag belong to the editor, so they are persisted separately.
 */
export interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export class SessionMetaStore {
  private readonly store: JsonStore<SessionMeta[]>;

  constructor(paths: BridgePaths) {
    this.store = new JsonStore<SessionMeta[]>(paths.sessions, () => []);
  }

  list(): SessionMeta[] {
    return this.store.read().filter(isMeta);
  }

  get(id: string): SessionMeta | undefined {
    return this.list().find((meta) => meta.id === id);
  }

  upsert(meta: SessionMeta): SessionMeta {
    const all = this.list();
    const index = all.findIndex((item) => item.id === meta.id);
    if (index >= 0) all[index] = meta;
    else all.push(meta);
    this.store.write(all);
    return meta;
  }

  patch(id: string, patch: Partial<Omit<SessionMeta, 'id'>>): SessionMeta | undefined {
    const all = this.list();
    const index = all.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const next: SessionMeta = { ...(all[index] as SessionMeta), ...patch, updatedAt: new Date().toISOString() };
    all[index] = next;
    this.store.write(all);
    return next;
  }

  remove(id: string): void {
    this.store.write(this.list().filter((meta) => meta.id !== id));
  }
}

/** Converts stored metadata into the wire DTO. */
export function toSessionInfo(meta: SessionMeta, status: SessionInfo['status'], messageCount: number): SessionInfo {
  return {
    id: meta.id,
    projectId: meta.projectId,
    title: meta.title,
    status,
    messageCount,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    archived: meta.archived,
  };
}

function isMeta(value: unknown): value is SessionMeta {
  const candidate = value as SessionMeta | undefined;
  return Boolean(candidate && typeof candidate.id === 'string' && typeof candidate.projectId === 'string');
}
