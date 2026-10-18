import {
  ErrorCode,
  RpcError,
  createId,
  nowIso,
  type AgentInfo,
  type AgentNode,
  type AgentStatus,
  type FileMention,
  type HistoryPage,
  type MessageInfo,
  type SessionInfo,
  type SessionStatus,
} from '@conduit4dsh2vscode/protocol';
import { appendJsonLine } from '../store/json-store';
import { sessionLogFile, type BridgePaths } from '../store/paths';
import type { AppendResult, SessionBackend } from '../runtime/backend';
import type { SessionEventHub } from '../runtime/events';
import type { Logger } from '../runtime/logger';
import { ROOT_AGENT_ID, type AgentRegistry } from './agent-registry';
import { SessionMetaStore, toSessionInfo, type SessionMeta } from './session-store';

export interface SessionServiceDeps {
  replay: SessionBackend;
  live?: SessionBackend;
  meta: SessionMetaStore;
  hub: SessionEventHub;
  agents: AgentRegistry;
  paths: BridgePaths;
  log: Logger;
}

/**
 * Session orchestration: metadata, status and history on top of a backend.
 *
 * The backend decides where a transcript comes from (live harness loop or
 * local replay); everything the editor cares about is handled here.
 */
export class SessionService {
  private readonly statuses = new Map<string, SessionStatus>();

  constructor(private readonly deps: SessionServiceDeps) {
    this.deps.hub.onStatus((sessionId, status) => {
      this.statuses.set(sessionId, status);
    });
  }

  get mode(): 'live' | 'replay' {
    return this.backend.mode;
  }

  private get backend(): SessionBackend {
    return this.deps.live ?? this.deps.replay;
  }

  async list(filter: { projectId?: string; includeArchived?: boolean } = {}): Promise<SessionInfo[]> {
    const metas = new Map(this.deps.meta.list().map((meta) => [meta.id, meta]));
    const extras = (await this.backend.listExtraSessionIds?.()) ?? [];
    const now = nowIso();

    for (const id of extras) {
      if (metas.has(id)) continue;
      const meta: SessionMeta = {
        id,
        projectId: '',
        title: id,
        createdAt: now,
        updatedAt: now,
        archived: false,
      };
      this.deps.meta.upsert(meta);
      metas.set(id, meta);
    }

    return [...metas.values()]
      .map((meta) => toSessionInfo(meta, this.statusOf(meta), 0))
      .filter((session) => (filter.projectId ? session.projectId === filter.projectId : true))
      .filter((session) => (filter.includeArchived ? true : !session.archived))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(sessionId: string): Promise<{ session: SessionInfo; messages: MessageInfo[] }> {
    const meta = this.requireMeta(sessionId);
    const messages = await this.backend.readMessages(sessionId);
    return { session: toSessionInfo({ ...meta }, this.statusOf(meta), messages.length), messages };
  }

  async history(sessionId: string, before: string | undefined, limit: number): Promise<HistoryPage> {
    const { messages } = await this.get(sessionId);
    const size = Math.min(Math.max(Math.trunc(limit) || 30, 1), 200);
    const end = before ? messages.findIndex((message) => message.id === before) : messages.length;
    if (end <= 0) return { messages: [], hasMore: false, total: messages.length };
    const start = Math.max(0, end - size);
    return { messages: messages.slice(start, end), hasMore: start > 0, total: messages.length };
  }

  async create(input: { projectId: string; title?: string }): Promise<SessionInfo> {
    const id = createId('s');
    const now = nowIso();
    const meta: SessionMeta = {
      id,
      projectId: input.projectId,
      title: input.title?.trim() || 'New conversation',
      createdAt: now,
      updatedAt: now,
      archived: false,
    };

    // Persist metadata first: the harness may reject session creation, and the
    // user should still see the conversation with a retry path.
    this.deps.meta.upsert(meta);
    await this.backend.create(id, meta.title);
    return toSessionInfo(meta, 'idle', 0);
  }

  async append(sessionId: string, content: string, mentions?: FileMention[]): Promise<AppendResult> {
    this.requireMeta(sessionId);
    this.deps.meta.patch(sessionId, {});
    this.deps.hub.setStatus(sessionId, 'running');
    try {
      return await this.backend.append(sessionId, content, mentions);
    } catch (error) {
      this.deps.hub.setStatus(sessionId, 'idle');
      throw error;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.backend.cancel(sessionId);
    this.deps.hub.setStatus(sessionId, 'idle');
  }

  rename(sessionId: string, title: string): void {
    this.requireMeta(sessionId);
    this.deps.meta.patch(sessionId, { title: title.trim() || 'Untitled' });
  }

  archive(sessionId: string, archived: boolean): void {
    this.requireMeta(sessionId);
    this.deps.meta.patch(sessionId, { archived });
    this.deps.hub.setStatus(sessionId, archived ? 'archived' : 'idle');
  }

  async remove(sessionId: string): Promise<void> {
    this.requireMeta(sessionId);
    await this.backend.cancel(sessionId).catch(() => undefined);
    this.deps.meta.remove(sessionId);
    this.deps.agents.clear(sessionId);
    this.statuses.delete(sessionId);
  }

  /**
   * Copies a transcript into a new session.
   *
   * The harness exposes no branch primitive, so forking is only offered for
   * locally stored conversations. Reporting this explicitly beats silently
   * producing an empty session.
   */
  async fork(sessionId: string, fromMessageId?: string): Promise<SessionInfo> {
    if (this.backend.mode !== 'replay') {
      throw new RpcError(
        ErrorCode.ServerNotReady,
        'fork requires a locally stored transcript; the live harness backend does not support branching',
      );
    }

    const { session, messages } = await this.get(sessionId);
    const index = fromMessageId ? messages.findIndex((message) => message.id === fromMessageId) : -1;
    const slice = index >= 0 ? messages.slice(0, index + 1) : messages;

    const forked = await this.create({ projectId: session.projectId, title: `${session.title} (fork)` });
    for (const message of slice) {
      appendJsonLine(sessionLogFile(this.deps.paths, forked.id), { ...message, id: createId('m') });
    }
    return { ...forked, messageCount: slice.length };
  }

  /* ------------------------------ agents ------------------------------ */

  agentTree(sessionId: string): AgentNode[] {
    const base = this.backend.agentTree?.(sessionId) ?? [];
    const registryRoot = this.deps.agents.tree(sessionId).find((node) => node.id === ROOT_AGENT_ID);
    const root = base[0];
    if (!root) return this.deps.agents.tree(sessionId);
    if (registryRoot) {
      root.children = registryRoot.children;
      root.startedAt = registryRoot.startedAt;
      root.toolCalls = registryRoot.toolCalls;
      root.messageCount = registryRoot.messageCount;
      if (registryRoot.status !== 'pending') root.status = registryRoot.status;
    }
    return [root];
  }

  agentList(sessionId: string): AgentInfo[] {
    const flatten = (nodes: AgentNode[]): AgentInfo[] =>
      nodes.flatMap((node) => {
        const { children, ...info } = node;
        return [info, ...flatten(children)];
      });
    return flatten(this.agentTree(sessionId));
  }

  getAgent(sessionId: string, agentId: string): AgentInfo | undefined {
    return this.deps.agents.get(sessionId, agentId);
  }

  cancelAgent(sessionId: string, agentId: string): AgentInfo | undefined {
    if (agentId === ROOT_AGENT_ID) return this.deps.agents.get(sessionId, agentId);
    const agent = this.deps.agents.setStatus(sessionId, agentId, 'cancelled');
    if (agent) {
      this.deps.hub.emit(sessionId, 'agent.status', {
        agent: {
          id: agent.id,
          ...(agent.parentId !== undefined ? { parentId: agent.parentId } : {}),
          name: agent.name,
          kind: agent.kind,
          status: 'cancelled' as AgentStatus,
        },
        role: 'system',
        text: `agent ${agent.name} cancelled`,
      });
    }
    return agent;
  }

  /* ------------------------------ model switching ------------------------------ */

  setDefaultEffort(effort: string | undefined): void {
    this.backend.setDefaultEffort?.(effort);
  }

  selectModel(sessionId: string, provider: string, model: string, effort?: string): boolean {
    return this.backend.selectModel?.(sessionId, provider, model, effort) ?? false;
  }

  /* ------------------------------ internals ------------------------------ */

  private requireMeta(sessionId: string): SessionMeta {
    const meta = this.deps.meta.get(sessionId);
    if (!meta) {
      throw new RpcError(ErrorCode.SessionNotFound, `session not found: ${sessionId}`, { sessionId });
    }
    return meta;
  }

  private statusOf(meta: SessionMeta): SessionStatus {
    if (meta.archived) return 'archived';
    return this.statuses.get(meta.id) ?? 'idle';
  }
}
