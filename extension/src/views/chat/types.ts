/**
 * Contract between the chat webview and its host.
 *
 * The host sends `InboundMessage`, the page replies with `OutboundMessage`.
 * Keeping both sides on these types is what makes the panel testable without a
 * VS Code instance.
 */

export type CardKind = 'user' | 'assistant' | 'reasoning' | 'tool' | 'system' | 'error';

export type AgentStatus = 'pending' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled';

export interface ToolCall {
  id: string;
  name: string;
  args?: unknown;
  status?: 'running' | 'success' | 'error' | 'cancelled';
  result?: unknown;
  durationMs?: number;
}

export interface ChatCard {
  /** Client-side identity, used to locate a streaming card. */
  key: string;
  kind: CardKind;
  title: string;
  meta?: string;
  subtitle?: string;
  ts?: number | string;
  text: string;
  collapsed: boolean;
  streaming: boolean;
  /** Turn number; increments on every user message. */
  turn: number;
  /** Owning agent: '' or 'root' for the main transcript. */
  agentId: string;
  status?: string;
  tool?: ToolCall;
}

export interface AgentInfo {
  id: string;
  name?: string;
  kind?: string;
  status?: AgentStatus | string;
  task?: string;
  error?: string;
  toolCalls?: number;
  durationMs?: number;
  children?: AgentInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
}

export interface ProviderInfo {
  id: string;
  kind: string;
  hasKey: boolean;
  models: ModelInfo[];
}

export interface SessionInfo {
  id: string;
  projectId: string;
  title: string;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface HistoryMessage {
  id?: string;
  role: string;
  content: string;
  ts?: number | string;
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  root: string;
}

export interface Mention {
  path: string;
  name?: string;
  token?: string;
}

/** A session event forwarded verbatim by the host. */
export interface SessionEvent {
  type: string;
  ts?: number;
  role?: string;
  text?: string;
  agent?: { id?: string; parentId?: string; name?: string; kind?: string; status?: string };
  tool?: ToolCall;
}

export type OutboundMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string; mentions?: Array<{ path: string; name?: string }> }
  | { type: 'setModel'; modelId: string; effort?: string }
  | { type: 'stop' }
  | { type: 'listFiles' }
  | { type: 'history' }
  | { type: 'newEntry' }
  | { type: 'confirmChanges' }
  | { type: 'compareCode' }
  | { type: 'copy'; text: string }
  | { type: 'collapseAll'; collapsed: boolean }
  | { type: 'expandAll' }
  | { type: 'openUiSettings' }
  | { type: 'addProvider' };

export interface SnapshotMessage {
  type: 'snapshot';
  session: SessionInfo | null;
  messages: HistoryMessage[];
  providers: ProviderInfo[];
  modelId: string;
  effort?: string;
  agents: AgentInfo[];
  hasMoreHistory?: boolean;
  historyTotal?: number;
}

export interface HistoryPageMessage {
  type: 'historyPage';
  messages: HistoryMessage[];
  hasMore: boolean;
  total?: number;
  error?: string;
}

export type InboundMessage =
  | SnapshotMessage
  | HistoryPageMessage
  | { type: 'event'; event: SessionEvent }
  | { type: 'state'; status: string }
  | { type: 'agent'; agent: AgentInfo }
  | { type: 'providers'; providers: ProviderInfo[]; defaultModelId?: string }
  | { type: 'changes'; total: number; confirmedAt: string }
  | { type: 'theme'; palette: Record<string, string> }
  | { type: 'prefs'; prefs: Record<string, unknown> }
  | { type: 'serverMode'; mode: 'live' | 'replay' }
  | { type: 'collapseAll'; collapsed: boolean }
  | { type: 'expandAll' }
  | { type: 'copied' }
  | { type: 'fileList'; files: FileEntry[]; truncated?: boolean; error?: string }
  | { type: 'error'; message: string };
