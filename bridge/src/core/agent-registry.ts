import { existsSync } from 'node:fs';
import type { AgentInfo, AgentKind, AgentNode, AgentStatus } from '@conduit4dsh2vscode/protocol';
import { JsonStore } from '../store/json-store';
import { agentLogFile, type BridgePaths } from '../store/paths';

export interface AgentUpsert {
  id: string;
  parentId?: string;
  name?: string;
  kind?: AgentKind;
  role?: string;
  task?: string;
  modelId?: string;
  status?: AgentStatus;
}

const TERMINAL: ReadonlySet<AgentStatus> = new Set(['success', 'error', 'cancelled']);

/** The root node uses a stable id so the client can address it across turns. */
export const ROOT_AGENT_ID = 'root';

/**
 * Reduces the event stream into a per-session agent tree.
 *
 * The harness emits flat events; the UI needs hierarchy, counters and timings,
 * so every event carrying an agent reference upserts a record here.
 */
export class AgentRegistry {
  constructor(private readonly paths: BridgePaths) {}

  list(sessionId: string): AgentInfo[] {
    return this.store(sessionId).read();
  }

  get(sessionId: string, agentId: string): AgentInfo | undefined {
    return this.list(sessionId).find((agent) => agent.id === agentId);
  }

  upsert(sessionId: string, input: AgentUpsert): AgentInfo {
    const store = this.store(sessionId);
    const agents = store.read();
    const index = agents.findIndex((agent) => agent.id === input.id);
    const now = new Date().toISOString();

    if (index >= 0) {
      const previous = agents[index] as AgentInfo;
      const next: AgentInfo = {
        ...previous,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.task !== undefined ? { task: input.task } : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      };
      if (TERMINAL.has(next.status) && !previous.endedAt) {
        next.endedAt = now;
        next.durationMs = Date.now() - Date.parse(previous.startedAt);
      }
      agents[index] = next;
      store.write(agents);
      return next;
    }

    const created: AgentInfo = {
      id: input.id,
      sessionId,
      name: input.name ?? input.id,
      kind: input.kind ?? (input.parentId ? 'sub' : 'root'),
      status: input.status ?? 'pending',
      startedAt: now,
      toolCalls: 0,
      messageCount: 0,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.task !== undefined ? { task: input.task } : {}),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    };
    if (TERMINAL.has(created.status)) {
      created.endedAt = now;
      created.durationMs = 0;
    }
    agents.push(created);
    store.write(agents);
    return created;
  }

  setStatus(sessionId: string, agentId: string, status: AgentStatus, error?: string): AgentInfo | undefined {
    if (!this.get(sessionId, agentId)) this.upsert(sessionId, { id: agentId, status });
    const store = this.store(sessionId);
    const agents = store.read();
    const index = agents.findIndex((agent) => agent.id === agentId);
    if (index < 0) return undefined;

    const previous = agents[index] as AgentInfo;
    const now = new Date().toISOString();
    const next: AgentInfo = { ...previous, status, ...(error !== undefined ? { error } : {}) };
    if (TERMINAL.has(status)) {
      const endedAt = previous.endedAt ?? now;
      next.endedAt = endedAt;
      next.durationMs = Date.parse(endedAt) - Date.parse(previous.startedAt);
    }
    agents[index] = next;
    store.write(agents);
    return next;
  }

  bump(
    sessionId: string,
    agentId: string,
    patch: { toolCalls?: number; messageCount?: number; lastText?: string },
  ): AgentInfo | undefined {
    const store = this.store(sessionId);
    const agents = store.read();
    const index = agents.findIndex((agent) => agent.id === agentId);
    if (index < 0) return undefined;

    const previous = agents[index] as AgentInfo;
    const next: AgentInfo = {
      ...previous,
      toolCalls: previous.toolCalls + (patch.toolCalls ?? 0),
      messageCount: previous.messageCount + (patch.messageCount ?? 0),
      ...(patch.lastText !== undefined ? { lastText: patch.lastText } : {}),
    };
    agents[index] = next;
    store.write(agents);
    return next;
  }

  /** Builds one tree; orphan nodes attach to the root so the UI never loses them. */
  tree(sessionId: string): AgentNode[] {
    const nodes = new Map<string, AgentNode>();
    for (const agent of this.list(sessionId)) nodes.set(agent.id, { ...agent, children: [] });

    const roots: AgentNode[] = [];
    const fallback = nodes.get(ROOT_AGENT_ID);
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else if (fallback && node.id !== ROOT_AGENT_ID) fallback.children.push(node);
      else roots.push(node);
    }

    const sort = (list: AgentNode[]): void => {
      list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      for (const node of list) sort(node.children);
    };
    sort(roots);
    return roots;
  }

  clear(sessionId: string): void {
    const file = agentLogFile(this.paths, sessionId);
    if (!existsSync(file)) return;
    try {
      this.store(sessionId).write([]);
    } catch {
      /* a missing file is already the desired state */
    }
  }

  private store(sessionId: string): JsonStore<AgentInfo[]> {
    return new JsonStore<AgentInfo[]>(agentLogFile(this.paths, sessionId), () => []);
  }
}
