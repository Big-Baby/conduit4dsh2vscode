import type {
  AgentInfo,
  AgentKind,
  AgentRef,
  AgentStatus,
  SessionEvent,
  SessionEventType,
  SessionStatus,
  ToolCallInfo,
} from '@conduit4dsh2vscode/protocol';
import { AgentRegistry } from '../core/agent-registry';

export type Unsubscribe = () => void;

export interface EventPayload {
  role?: SessionEvent['role'];
  text?: string;
  tool?: ToolCallInfo;
  agent?: AgentRef;
}

type EventListener = (sessionId: string, event: SessionEvent) => void;
type StatusListener = (sessionId: string, status: SessionStatus) => void;
type AgentListener = (sessionId: string, agent: AgentInfo) => void;

/**
 * Single egress point for session events.
 *
 * It assigns sequence numbers, keeps the agent registry in sync and fan-outs to
 * transport listeners. Backends only describe what happened; they never touch
 * the wire.
 */
export class SessionEventHub {
  private seq = 0;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly agentListeners = new Set<AgentListener>();

  constructor(private readonly agents: AgentRegistry) {}

  onEvent(listener: EventListener): Unsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onAgent(listener: AgentListener): Unsubscribe {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  emit(sessionId: string, type: SessionEventType, payload: EventPayload = {}): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `e_${this.seq.toString(36)}_${Date.now().toString(36)}`,
      seq: this.seq,
      ts: new Date().toISOString(),
      type,
      ...(payload.role !== undefined ? { role: payload.role } : {}),
      ...(payload.text !== undefined ? { text: payload.text } : {}),
      ...(payload.tool !== undefined ? { tool: payload.tool } : {}),
      ...(payload.agent !== undefined ? { agent: payload.agent } : {}),
    };

    if (event.agent?.id) this.track(sessionId, event);
    for (const listener of this.eventListeners) listener(sessionId, event);
    return event;
  }

  setStatus(sessionId: string, status: SessionStatus): void {
    for (const listener of this.statusListeners) listener(sessionId, status);
  }

  emitAgent(sessionId: string, agent: AgentInfo): void {
    for (const listener of this.agentListeners) listener(sessionId, agent);
  }

  private track(sessionId: string, event: SessionEvent): void {
    const ref = event.agent;
    if (!ref?.id) return;

    const base = {
      id: ref.id,
      ...(ref.parentId !== undefined ? { parentId: ref.parentId } : {}),
      ...(ref.name !== undefined ? { name: ref.name } : {}),
      ...(ref.kind !== undefined ? { kind: ref.kind } : {}),
      ...(ref.task !== undefined ? { task: ref.task } : {}),
    };

    switch (event.type) {
      case 'agent.spawn':
        this.agents.upsert(sessionId, { ...base, status: ref.status ?? 'running' });
        break;
      case 'agent.status':
        this.agents.setStatus(sessionId, ref.id, ref.status ?? 'running');
        break;
      case 'agent.result':
        this.agents.setStatus(sessionId, ref.id, ref.status ?? 'success');
        break;
      case 'tool.call':
        this.agents.upsert(sessionId, { ...base, status: 'running' });
        this.agents.bump(sessionId, ref.id, { toolCalls: 1 });
        break;
      case 'assistant.message': {
        const updated = this.agents.bump(sessionId, ref.id, {
          messageCount: 1,
          lastText: event.text ?? '',
        });
        if (!updated) this.agents.upsert(sessionId, { ...base, status: 'running' });
        break;
      }
      case 'error':
        this.agents.setStatus(sessionId, ref.id, 'error', event.text);
        break;
      default:
        if (!this.agents.get(sessionId, ref.id)) {
          this.agents.upsert(sessionId, { ...base, status: 'running' });
        }
        break;
    }

    const latest = this.agents.get(sessionId, ref.id);
    if (latest) this.emitAgent(sessionId, latest);
  }
}

/** Maps harness status strings onto the protocol vocabulary. */
export function mapAgentStatus(raw: string): AgentStatus {
  switch (raw) {
    case 'running':
    case 'streaming':
    case 'stepping':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'error':
      return 'error';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'pending':
      return 'pending';
    case 'idle':
    case 'completed':
    case 'success':
      return 'success';
    default:
      return 'running';
  }
}

export function agentKindOf(status: AgentStatus): AgentKind {
  return status === 'pending' ? 'worker' : 'sub';
}
