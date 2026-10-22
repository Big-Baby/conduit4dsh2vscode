import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  createId,
  type AgentNode,
  type AgentRef,
  type AgentStatus,
  type FileMention,
  type MessageInfo,
  type SessionStatus,
} from '@conduit4dsh2vscode/protocol';
import type { AttachmentsService, DefaultModelService, LiveAgent, SessionQueryService, SessionsService } from '../dsh/context';
import {
  extractText,
  formatAgentError,
  loadCreateUserMessage,
  loadInstallModelSelection,
  messagesFromEvents,
  type CreateUserMessage,
} from '../dsh/messages';
import { asReasoningEffort, type InstallModelSelection, type ModelSelection, type ModelSelectionRef } from '../dsh/model-selection';
import { readSessionLog } from '../dsh/session-log';
import type { Logger } from '../runtime/logger';
import type { AppendResult, SessionBackend } from './backend';
import type { SessionEventHub } from './events';
import { mapAgentStatus } from './events';

export interface LiveBackendDeps {
  agents:
    | {
        create(options: {
          sessionId: string;
          meta?: Record<string, unknown>;
          agentOptions?: Record<string, unknown>;
          setup?: (agentCtx: unknown, agent: unknown) => void;
        }): Promise<{ agent: LiveAgent }>;
        resume(options: {
          resumeSessionId: string;
          agentOptions?: Record<string, unknown>;
          setup?: (agentCtx: unknown, agent: unknown) => void;
        }): Promise<{ agent: LiveAgent }>;
      }
    | undefined;
  sessions: SessionsService | undefined;
  sessionQuery: SessionQueryService | undefined;
  defaultModel: DefaultModelService | undefined;
  attachments: AttachmentsService | undefined;
  home: string;
  hub: SessionEventHub;
  log: Logger;
  /** Cordis event subscription; handlers receive every argument the emitter passes. */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void;
}

const MAX_MENTION_FILES = 10;
const MAX_MENTION_BYTES = 512 * 1024;
const MAX_MENTION_TOTAL_BYTES = 2 * 1024 * 1024;
const INLINE_MAX_CHARS = 60_000;

interface StreamFrame {
  type: string;
  chunk?: {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    toolName?: string;
    argumentsDelta?: string;
  };
}

interface SessionRecord {
  header: { id: string; createdAt: number; origin?: string };
}

/**
 * Real agent loop backend.
 *
 * Events are streamed from the harness and reduced into protocol events. A turn
 * may contain several model steps (tool calls), so the assistant message is
 * emitted once per turn when the agent returns to idle, not at each step.
 */
export class LiveBackend implements SessionBackend {
  readonly mode = 'live' as const;

  private readonly live = new Map<string, LiveAgent>();
  /** Sessions created or resumed by the bridge; their agent is the conversation root. */
  private readonly primary = new Set<string>();
  private readonly streams = new Map<string, string>();
  private readonly toolArgs = new Map<string, string>();
  private readonly userCancelled = new Set<string>();
  private readonly selections = new Map<string, ModelSelectionRef>();
  private readonly disposers: Array<() => void> = [];
  /**
   * Live sub-agents per owning conversation.
   *
   * The harness reports sub-agents as ordinary agents with their own session;
   * keeping the handles is what makes stopping *one* of them possible instead
   * of only ending the whole turn.
   */
  private readonly children = new Map<string, Map<string, LiveAgent>>();
  /** Tool calls that started but have not reported a result yet. */
  private readonly openCalls = new Map<string, Set<string>>();

  private createUser: CreateUserMessage | undefined;
  private installSelection: InstallModelSelection | undefined;
  private globalEffort: string | undefined;

  constructor(private readonly deps: LiveBackendDeps) {}

  get available(): boolean {
    return Boolean(this.deps.agents && this.deps.sessions && this.createUser);
  }

  async init(): Promise<void> {
    if (!this.deps.agents || !this.deps.sessions) {
      this.deps.log.debug('live backend unavailable: agents/sessions service missing');
      return;
    }

    this.createUser = await loadCreateUserMessage();
    this.installSelection = await loadInstallModelSelection();
    if (!this.createUser) {
      this.deps.log.warn('live backend unavailable: createUserMessage could not be resolved');
      return;
    }

    this.subscribe();
    this.deps.log.info(
      `live backend ready (model selection ${this.installSelection ? 'enabled' : 'unavailable'})`,
    );
  }

  /* ------------------------------ sessions ------------------------------ */

  async create(sessionId: string, title: string): Promise<void> {
    const agents = this.deps.agents;
    if (!agents) return;

    this.primary.add(sessionId);
    try {
      const { agent } = await agents.create({
        sessionId,
        meta: { cwd: process.cwd(), title },
        agentOptions: this.agentOptions(),
        ...(this.selectionSetup(sessionId) ? { setup: this.selectionSetup(sessionId) } : {}),
      });
      this.live.set(sessionId, agent);
    } catch (error) {
      // The session metadata stays valid; the agent is created on first use.
      this.primary.delete(sessionId);
      this.deps.log.warn(`session ${sessionId} not pre-created: ${(error as Error).message}`);
    }
  }

  async readMessages(sessionId: string): Promise<MessageInfo[]> {
    if (this.deps.sessionQuery) {
      try {
        const snapshot = await this.deps.sessionQuery.readSession(sessionId);
        const messages = messagesFromEvents(snapshot.events ?? []);
        if (messages.length) return messages;
      } catch {
        // No persisted log yet: fall through to the file reader.
      }
    }

    const events = readSessionLog(this.deps.home, sessionId);
    if (!events.length) return [];
    return messagesFromEvents(events);
  }

  async append(sessionId: string, content: string, mentions?: FileMention[]): Promise<AppendResult> {
    const agent = await this.ensureAgent(sessionId);
    if (!agent || !this.createUser) {
      throw new Error('live agent loop is unavailable');
    }

    const messageId = createId('m');
    this.deps.hub.emit(sessionId, 'user.message', { role: 'user', text: content });

    const parts: unknown[] = [{ type: 'text', text: content }];
    if (mentions?.length) parts.push(...(await this.fileParts(mentions)));

    agent.followup(this.createUser({ content: parts, source: { kind: 'user' } }));

    void agent
      .whenIdle()
      .then(async () => {
        await this.deps.sessions?.flush(agent.session);
        this.flushTurnText(sessionId, agent);
      })
      .catch(() => undefined);

    return { messageId, status: 'running' };
  }

  async cancel(sessionId: string): Promise<void> {
    this.userCancelled.add(sessionId);

    // Sub-agents run their own turns; cancelling the root alone leaves them
    // working and their tool cards spinning forever.
    const children = this.children.get(sessionId);
    this.children.delete(sessionId);
    if (children) {
      for (const child of children.values()) {
        try {
          child.cancel({ kind: 'user' });
        } catch {
          // Already idle.
        }
      }
    }

    const agent = this.live.get(sessionId);
    try {
      agent?.cancel({ kind: 'user' });
    } catch {
      // Cancelling an idle agent is a no-op.
    }

    this.interruptTools(sessionId);
    if (agent) this.flushTurnText(sessionId, agent);
  }

  /** Stops one sub-agent; the root turn keeps running. */
  cancelAgent(sessionId: string, agentId: string): boolean {
    if (agentId === 'root') {
      void this.cancel(sessionId);
      return true;
    }

    const target = this.children.get(sessionId)?.get(agentId);
    if (!target) return false;
    try {
      target.cancel({ kind: 'user' });
    } catch {
      return false;
    }
    this.children.get(sessionId)?.delete(agentId);
    return true;
  }

  /** Maps a harness agent to the conversation that owns it. */
  sessionIdOfAgent(agent: unknown): string | undefined {
    if (!agent) return undefined;
    return this.ownerSessionOf(agent as LiveAgent);
  }

  /** Makes a session addressable by the harness (create or resume its agent). */
  async ensureLive(sessionId: string): Promise<boolean> {
    return Boolean(await this.ensureAgent(sessionId));
  }

  async listExtraSessionIds(): Promise<string[]> {
    if (!this.deps.sessionQuery) return [];
    try {
      const records = (await this.deps.sessionQuery.listSessions()) as SessionRecord[];
      return records.filter((record) => record.header.origin !== 'subagent').map((record) => record.header.id);
    } catch {
      return [];
    }
  }

  /* ------------------------------ agents ------------------------------ */

  agentTree(sessionId: string): AgentNode[] {
    const agent = this.live.get(sessionId);
    return [
      {
        id: 'root',
        sessionId,
        name: 'main',
        kind: 'root',
        status: agent ? mapAgentStatus(agent.status) : 'success',
        startedAt: new Date().toISOString(),
        toolCalls: 0,
        messageCount: 0,
        children: [],
      },
    ];
  }

  setDefaultEffort(effort: string | undefined): void {
    const next = effort?.trim() || undefined;
    if (next === this.globalEffort) return;
    this.globalEffort = next;

    for (const selection of this.selections.values()) {
      const current = selection.current;
      if (!current) continue;
      selection.current = next
        ? { provider: current.provider, model: current.model, reasoningEffort: asReasoningEffort(next) }
        : { provider: current.provider, model: current.model };
    }
  }

  selectModel(sessionId: string, provider: string, model: string, effort?: string): boolean {
    const selection = this.selections.get(sessionId);
    if (!selection || !provider || !model) return false;
    const trimmed = effort?.trim();
    selection.current = {
      provider,
      model,
      ...(trimmed ? { reasoningEffort: asReasoningEffort(trimmed) } : {}),
    };
    return true;
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    this.disposers.length = 0;
  }

  /* ------------------------------ event mapping ------------------------------ */

  private subscribe(): void {
    this.disposers.push(
      this.deps.on('agent/assistant-stream', (payload) => this.onStream(payload)),
      this.deps.on('agent/status', (payload) => this.onStatus(payload)),
      this.deps.on('agent/error', (payload) => this.onError(payload)),
      this.deps.on('agent/request-error', (payload) => this.onError(payload)),
      this.deps.on('agent/created', (payload) => this.onLifecycle(payload, 'agent.spawn')),
      this.deps.on('agent/disposed', (payload) => this.onLifecycle(payload, 'agent.result')),
      // Tool outcomes are session events, not stream chunks: without this the
      // transcript keeps every tool card stuck on "running" forever.
      this.deps.on('session/event', (session: unknown, event: unknown) =>
        this.onSessionEvent(session, event),
      ),
    );
  }

  /**
   * Mirrors `tool/result` session events onto the transcript.
   *
   * The harness appends `tool/call` and `tool/result` to the session log; the
   * latter carries the outcome under `message.toolCallId` / `message.isError`,
   * which is the same id the streaming `tool-call-delta` used.
   */
  private onSessionEvent(session: unknown, raw: unknown): void {
    const event = raw as { type?: string; data?: unknown } | undefined;
    if (event?.type !== 'tool/result') return;

    const sessionId = String((session as { id?: unknown } | undefined)?.id ?? '');
    if (!sessionId) return;
    const owner = this.ownerOfSessionId(sessionId);
    if (!owner) return;

    const data = event.data as
      | { message?: { toolCallId?: unknown; content?: unknown; isError?: unknown } }
      | undefined;
    const message = data?.message;
    const id = String(message?.toolCallId ?? '');
    if (!id) return;

    const result = extractText(message);
    this.openCalls.get(owner)?.delete(id);
    this.deps.hub.emit(owner, 'tool.result', {
      tool: {
        id,
        name: '',
        args: undefined,
        status: message?.isError ? 'error' : 'success',
        ...(result ? { result } : {}),
      },
      agent: { id: 'root' },
    });
  }

  /** Session-event ids are the harness ids; sub-agent sessions fold into the root. */
  private ownerOfSessionId(id: string): string | undefined {
    if (this.live.has(id) || this.primary.has(id)) return id;
    for (const [sessionId, handle] of this.live) {
      if (this.sessionStatusOf(handle) === 'running') return sessionId;
    }
    return undefined;
  }

  private onStream(payload: unknown): void {
    const parsed = payload as { agent?: LiveAgent; frame?: StreamFrame } | undefined;
    const agent = parsed?.agent;
    const frame = parsed?.frame;
    if (!agent || !frame?.chunk?.type) return;

    const sessionId = this.ownerSessionOf(agent);
    if (!sessionId) return;
    this.rememberAgent(sessionId, agent);
    const streamKey = this.streamKey(sessionId, agent);
    const chunk = frame.chunk;

    switch (chunk.type) {
      case 'text-delta': {
        const text = chunk.text ?? '';
        if (!text) return;
        this.streams.set(streamKey, `${this.streams.get(streamKey) ?? ''}${text}`);
        this.deps.hub.emit(sessionId, 'text.delta', { role: 'assistant', text, agent: this.refOf(agent) });
        return;
      }
      case 'reasoning-delta': {
        const text = chunk.text ?? '';
        if (!text) return;
        this.deps.hub.emit(sessionId, 'reasoning.delta', { text, agent: this.refOf(agent) });
        return;
      }
      case 'tool-call-delta': {
        const id = String(chunk.id ?? chunk.name ?? 'tool');
        const name = String(chunk.name ?? chunk.toolName ?? id);
        const key = `${streamKey}:${id}`;
        const raw = `${this.toolArgs.get(key) ?? ''}${String(chunk.argumentsDelta ?? '')}`;
        this.toolArgs.set(key, raw);

        let args: unknown = raw;
        try {
          args = JSON.parse(raw);
        } catch {
          // Arguments arrive in fragments; the raw string is shown meanwhile.
        }
        this.trackCall(sessionId, id);
        this.deps.hub.emit(sessionId, 'tool.call', {
          tool: { id, name, args, status: 'running' },
          agent: this.refOf(agent),
        });
        return;
      }
      case 'finish': {
        // Step boundary, not turn boundary: only clear argument buffers.
        for (const key of [...this.toolArgs.keys()]) {
          if (key.startsWith(`${streamKey}:`)) this.toolArgs.delete(key);
        }
        return;
      }
      default:
        return;
    }
  }

  private onStatus(payload: unknown): void {
    const parsed = payload as { agent?: LiveAgent; status?: string } | undefined;
    const agent = parsed?.agent;
    if (!agent) return;

    const sessionId = this.ownerSessionOf(agent);
    if (!sessionId) return;
    this.rememberAgent(sessionId, agent);

    const status = this.terminalStatusOf(sessionId, parsed.status ?? agent.status);
    this.deps.hub.emit(sessionId, 'agent.status', { agent: { ...this.refOf(agent), status } });

    if (status === 'success' || status === 'cancelled') {
      this.flushTurnText(sessionId, agent);
      this.releaseAgent(sessionId, agent);
    }
  }

  private onError(payload: unknown): void {
    const parsed = payload as { agent?: LiveAgent; error?: { message?: string }; message?: string } | undefined;
    const agent = parsed?.agent;
    if (!agent) return;

    const sessionId = this.ownerSessionOf(agent);
    if (!sessionId) return;
    this.deps.hub.emit(sessionId, 'error', {
      text: formatAgentError(parsed.error?.message ?? parsed.message ?? 'agent failed'),
      agent: this.refOf(agent),
    });
  }

  private onLifecycle(payload: unknown, type: 'agent.spawn' | 'agent.result'): void {
    const agent = (payload as { agent?: LiveAgent } | undefined)?.agent;
    if (!agent) return;

    const sessionId = this.ownerSessionOf(agent);
    if (!sessionId) return;

    // Resuming a conversation root also emits `agent/created`; announcing it as
    // a sub-agent would inject a bogus system note into the transcript.
    if (type === 'agent.spawn' && this.refOf(agent).id === 'root') return;

    if (type === 'agent.spawn') this.rememberAgent(sessionId, agent);
    else this.releaseAgent(sessionId, agent);

    const mapped =
      type === 'agent.spawn'
        ? mapAgentStatus(agent.status) === 'success'
          ? 'pending'
          : mapAgentStatus(agent.status)
        : this.terminalStatusOf(sessionId, agent.status);

    this.deps.hub.emit(sessionId, type, {
      agent: { ...this.refOf(agent), status: mapped },
      ...(type === 'agent.spawn' ? { text: `sub-agent ${agent.id ?? 'agent'} started` } : {}),
    });
  }

  /**
   * Emits the accumulated turn text once. Both `agent/status` and `whenIdle`
   * call this; the second call is a no-op because the buffer is cleared.
   */
  private flushTurnText(sessionId: string, agent: LiveAgent): void {
    const key = this.streamKey(sessionId, agent);
    const text = this.streams.get(key) ?? '';
    this.streams.delete(key);
    for (const toolKey of [...this.toolArgs.keys()]) {
      if (toolKey.startsWith(`${key}:`)) this.toolArgs.delete(toolKey);
    }
    if (text) {
      this.deps.hub.emit(sessionId, 'assistant.message', {
        role: 'assistant',
        text,
        agent: this.refOf(agent),
      });
    }
  }

  /* ------------------------------ internals ------------------------------ */

  /** Registers a sub-agent handle so it can be stopped on its own. */
  private rememberAgent(sessionId: string, agent: LiveAgent): void {
    const ref = this.refOf(agent);
    if (ref.id === 'root') return;
    let owned = this.children.get(sessionId);
    if (!owned) {
      owned = new Map();
      this.children.set(sessionId, owned);
    }
    owned.set(ref.id, agent);
  }

  private releaseAgent(sessionId: string, agent: LiveAgent): void {
    const id = this.refOf(agent).id;
    if (id === 'root') return;
    const owned = this.children.get(sessionId);
    if (!owned) return;
    owned.delete(id);
    if (!owned.size) this.children.delete(sessionId);
  }

  private trackCall(sessionId: string, callId: string): void {
    let calls = this.openCalls.get(sessionId);
    if (!calls) {
      calls = new Set();
      this.openCalls.set(sessionId, calls);
    }
    calls.add(callId);
  }

  /**
   * Closes every in-flight tool call after a cancel.
   *
   * The harness never reports a result for an interrupted call, so without
   * this the transcript keeps those cards on "(running)" indefinitely.
   */
  private interruptTools(sessionId: string): void {
    const calls = this.openCalls.get(sessionId);
    this.openCalls.delete(sessionId);
    for (const key of [...this.toolArgs.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.toolArgs.delete(key);
    }
    if (!calls?.size) return;

    for (const id of calls) {
      this.deps.hub.emit(sessionId, 'tool.result', {
        tool: { id, name: '', args: undefined, status: 'cancelled', result: 'interrupted by user' },
        agent: { id: 'root' },
      });
    }
  }

  private async ensureAgent(sessionId: string): Promise<LiveAgent | undefined> {
    const existing = this.live.get(sessionId);
    if (existing) return existing;

    const agents = this.deps.agents;
    if (!agents) return undefined;

    const agentOptions = this.agentOptions();
    const setup = this.selectionSetup(sessionId);
    this.primary.add(sessionId);

    try {
      const { agent } = await agents.create({
        sessionId,
        meta: { cwd: process.cwd() },
        agentOptions,
        ...(setup ? { setup } : {}),
      });
      this.live.set(sessionId, agent);
      return agent;
    } catch {
      try {
        const { agent } = await agents.resume({
          resumeSessionId: sessionId,
          agentOptions,
          ...(setup ? { setup } : {}),
        });
        this.live.set(sessionId, agent);
        return agent;
      } catch (error) {
        this.primary.delete(sessionId);
        this.deps.log.warn(`cannot create or resume agent for ${sessionId}: ${(error as Error).message}`);
        return undefined;
      }
    }
  }

  private selectionSetup(sessionId: string): ((agentCtx: unknown, agent: unknown) => void) | undefined {
    if (!this.installSelection) return undefined;
    const selection = this.selectionFor(sessionId);
    if (!selection) return undefined;

    return (agentCtx: unknown): void => {
      try {
        this.installSelection?.(agentCtx, selection);
      } catch (error) {
        this.deps.log.warn(`installModelSelection failed for ${sessionId}: ${(error as Error).message}`);
      }
    };
  }

  private selectionFor(sessionId: string): ModelSelectionRef | undefined {
    if (!this.installSelection) return undefined;
    let selection = this.selections.get(sessionId);
    if (!selection) {
      selection = { current: this.currentSelection(), assembled: undefined };
      this.selections.set(sessionId, selection);
    }
    return selection;
  }

  private currentSelection(): ModelSelection | undefined {
    const current = this.deps.defaultModel?.currentSelection?.() ?? {};
    if (!current.provider || !current.model) return undefined;
    return {
      provider: current.provider,
      model: current.model,
      ...(this.globalEffort ? { reasoningEffort: asReasoningEffort(this.globalEffort) } : {}),
    };
  }

  private agentOptions(): Record<string, unknown> {
    const current = this.deps.defaultModel?.currentSelection?.() ?? {};
    return {
      ...(current.provider ? { provider: current.provider } : {}),
      ...(current.model ? { model: current.model } : {}),
    };
  }

  private ownerSessionOf(agent: LiveAgent): string | undefined {
    const id = String(agent.session?.id ?? agent.id ?? '');
    if (!id) return undefined;
    if (this.live.has(id) || this.primary.has(id)) return id;

    // Sub-agents run their own session; attribute them to the active root.
    for (const [sessionId, handle] of this.live) {
      if (this.sessionStatusOf(handle) === 'running') return sessionId;
    }
    return undefined;
  }

  private refOf(agent: LiveAgent): AgentRef {
    const id = String(agent.session?.id ?? agent.id ?? '');
    if (this.live.has(id) || this.primary.has(id)) return { id: 'root' };
    return {
      id: id || 'agent',
      parentId: 'root',
      kind: 'sub',
      ...(agent.id ? { name: agent.id } : {}),
    };
  }

  private streamKey(sessionId: string, agent: LiveAgent): string {
    return `${sessionId}:${this.refOf(agent).id}`;
  }

  private sessionStatusOf(agent: LiveAgent): SessionStatus {
    const status = String(agent.status ?? '');
    return status === 'idle' || status === 'completed' ? 'idle' : 'running';
  }

  /** A user cancel is reported by the harness as idle; translate it back. */
  private terminalStatusOf(sessionId: string, rawStatus: unknown): AgentStatus {
    const mapped = mapAgentStatus(String(rawStatus ?? ''));
    if (mapped === 'running') {
      this.userCancelled.delete(sessionId);
      return mapped;
    }
    if (!this.userCancelled.has(sessionId)) return mapped;
    this.userCancelled.delete(sessionId);
    return mapped === 'success' ? 'cancelled' : mapped;
  }

  private async fileParts(mentions: FileMention[]): Promise<unknown[]> {
    const parts: unknown[] = [];
    const seen = new Set<string>();
    let total = 0;

    for (const mention of mentions.slice(0, MAX_MENTION_FILES)) {
      const path = mention.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);

      const name = mention.name ?? basename(path);
      let data: Buffer;
      try {
        const stat = statSync(path);
        if (!stat.isFile()) throw new Error('not a regular file');
        if (stat.size > MAX_MENTION_BYTES) {
          parts.push({ type: 'text', text: `[skipped] ${name} exceeds ${MAX_MENTION_BYTES / 1024} KiB` });
          continue;
        }
        data = readFileSync(path);
      } catch (error) {
        parts.push({ type: 'text', text: `[unavailable] ${path}: ${(error as Error).message}` });
        continue;
      }

      total += data.byteLength;
      if (total > MAX_MENTION_TOTAL_BYTES) {
        parts.push({ type: 'text', text: '[skipped] attachment budget exhausted' });
        break;
      }

      const saved = await this.trySaveAttachment(data, name);
      if (saved) {
        parts.push({ type: 'file', attachment: saved });
        continue;
      }

      const text = data.toString('utf8');
      const clipped = text.length > INLINE_MAX_CHARS ? `${text.slice(0, INLINE_MAX_CHARS)}\n[truncated]` : text;
      parts.push({
        type: 'text',
        text: `[file] ${name} (${path}, ${data.byteLength} bytes)\n\`\`\`\n${clipped}\n\`\`\``,
      });
    }

    return parts;
  }

  private async trySaveAttachment(data: Buffer, name: string): Promise<unknown | undefined> {
    const saveFile = this.deps.attachments?.saveFile;
    if (!saveFile) return undefined;
    try {
      return await saveFile({ data: new Uint8Array(data), name });
    } catch {
      return undefined;
    }
  }
}
