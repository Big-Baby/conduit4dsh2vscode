import type {
  AgentInfo,
  AgentKind,
  AgentStatus,
  PluginEventParams,
  SessionStatus,
  ToolCallInfo,
} from './models';

export type SessionEventType =
  | 'user.message'
  | 'assistant.message'
  | 'reasoning.delta'
  | 'text.delta'
  | 'tool.call'
  | 'tool.result'
  | 'context.inject'
  | 'error'
  | 'agent.spawn'
  | 'agent.status'
  | 'agent.result';

/** Attribution of an event to an agent. Absent means the root agent. */
export interface AgentRef {
  id: string;
  parentId?: string;
  name?: string;
  kind?: AgentKind;
  status?: AgentStatus;
  task?: string;
}

export interface SessionEvent {
  id: string;
  seq: number;
  ts: string;
  type: SessionEventType;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  tool?: ToolCallInfo;
  agent?: AgentRef;
}

/** Server-to-client notifications, keyed by method name. */
export interface NotificationMap {
  'session.event': { sessionId: string; event: SessionEvent };
  'session.status': { sessionId: string; status: SessionStatus };
  'agent.event': { sessionId: string; agent: AgentInfo };
  'model.changed': { providerId?: string; modelId?: string };
  'plugin.event': PluginEventParams;
  /**
   * A tool action is blocked until the user answers. The bridge waits for
   * `approval.respond`; the harness fails closed when nobody answers.
   */
  'approval.request': {
    sessionId: string;
    requestId: string;
    toolName: string;
    callId?: string;
    reason?: string;
    agentId?: string;
    /** Milliseconds before the bridge withdraws the question. */
    timeoutMs?: number;
  };
  'permission.changed': { sessionId?: string; preset: string };
  'system.shutting-down': { reason: string; clientId?: string };
}


export type NotificationName = keyof NotificationMap;

/** Client-to-server notifications used for subscription bookkeeping. */
export interface ClientNotificationMap {
  'session.subscribe': { sessionId: string };
  'session.unsubscribe': { sessionId: string };
}

export type ClientNotificationName = keyof ClientNotificationMap;
