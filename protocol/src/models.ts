/** Data transfer objects carried by the RPC methods. */

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  sessionCount: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
}

export type SessionStatus = 'idle' | 'running' | 'error' | 'archived';

export interface SessionInfo {
  id: string;
  projectId: string;
  title: string;
  status: SessionStatus;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageInfo {
  id: string;
  role: MessageRole;
  content: string;
  ts: string;
  toolCalls?: ToolCallInfo[];
}

export type ToolCallStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface ToolCallInfo {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result?: unknown;
  durationMs?: number;
}

export interface SessionDetail {
  session: SessionInfo;
  messages: MessageInfo[];
}

export interface HistoryPage {
  messages: MessageInfo[];
  hasMore: boolean;
  total: number;
}

/** A file referenced from a chat message. `path` must be absolute. */
export interface FileMention {
  kind: 'file';
  path: string;
  name?: string;
}

export interface WorkspaceFile {
  /** Path relative to its workspace root, POSIX separators. */
  path: string;
  name: string;
  size: number;
  root: string;
}

export interface WorkspaceFileList {
  files: WorkspaceFile[];
  truncated: boolean;
}

export interface ModelInfo {
  id: string;
  providerId: string;
  name: string;
  inputTypes?: string[];
}

export interface ProviderInfo {
  id: string;
  kind: string;
  baseURL?: string;
  /** Whether a credential is available. Secrets are never returned. */
  hasKey: boolean;
  models: ModelInfo[];
}

export interface ProviderSyncInput {
  id: string;
  kind?: string;
  baseURL?: string;
  /** Inline secret. Prefer `apiKeyEnv`. */
  apiKey?: string;
  /** Name of an environment variable holding the secret. */
  apiKeyEnv?: string;
  models?: Array<string | { id?: string; name?: string }>;
}

export interface ProviderSyncResult {
  providers: number;
  models: number;
  defaultModel?: string;
  warnings: string[];
}

export interface DefaultModelSelection {
  modelId?: string;
  /** Opaque adapter id, e.g. minimal | low | medium | high. */
  effort?: string;
}

export type SessionBackendMode = 'live' | 'replay';

export interface ServerInfo {
  protocolVersion: string;
  dshVersion: string;
  profile: string;
  transports: string[];
  pid: number;
  capabilities: string[];
  mode: SessionBackendMode;
}

/* ---------------------------------- agents --------------------------------- */

export type AgentKind = 'root' | 'sub' | 'worker';

export type AgentStatus = 'pending' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled';

export interface AgentInfo {
  id: string;
  sessionId: string;
  parentId?: string;
  name: string;
  kind: AgentKind;
  role?: string;
  status: AgentStatus;
  task?: string;
  modelId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  toolCalls: number;
  messageCount: number;
  lastText?: string;
  error?: string;
}

export interface AgentNode extends AgentInfo {
  children: AgentNode[];
}

/* --------------------------------- plugins --------------------------------- */

export type PluginTargetKind = 'bundle' | 'plugin';

export interface BundleItem {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  installed: boolean;
  optional: boolean;
  removable: boolean;
  readOnlyReason?: string;
  errorCode?: string;
  rows: string[];
}

export interface PluginItem {
  entryId: string;
  patchId?: string;
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  readOnlyReason?: string;
}

export type PluginApplication = 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';

export interface PluginChangeResult {
  changed: boolean;
  application: PluginApplication;
  stage: 'install' | 'enable' | 'remove';
  target: string;
  enabled?: boolean;
  errorCode?: string;
  diagnostic?: string;
  warnings?: string[];
}

export interface RegistryPluginItem {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  date?: string;
  bundle?: boolean | null;
}

export interface RegistrySearchResult {
  registry: string | null;
  results: RegistryPluginItem[];
  error?: string;
}

export interface PluginInspectResult {
  status: 'accepted' | 'refused';
  kind?: 'registry' | 'path' | 'git' | 'tarball';
  name?: string;
  version?: string;
  description?: string;
  bundle?: boolean | null;
  problem?: string;
  reason?: string;
}

export interface PluginInstallProgress {
  requestId: string;
  phase: 'installing' | 'cancelling' | 'applying';
  attempt?: { registry: string | null; index: number; total: number };
}

export interface PluginInstallLog {
  requestId?: string;
  stream: 'stdout' | 'stderr';
  text: string;
  exitCode?: number | null;
}

export interface PluginEventParams {
  type: 'install-state' | 'install-log' | 'changed';
  progress?: PluginInstallProgress;
  log?: PluginInstallLog;
  reason?: 'plugin' | 'bundle' | 'install' | 'remove';
}

/* ------------------------------ permissions ------------------------------ */

/** One selectable permission preset, as published by the harness catalog. */
export interface PermissionPresetOption {
  /** Stable preset key, also accepted by `permission.set`. */
  value: string;
  /** Display label. */
  name: string;
  /** One sentence on what the preset allows. */
  description?: string;
}

/**
 * Session permission state.
 *
 * `available` is false when the harness composes no permission service (an
 * older profile, or the replay backend); clients hide the control instead of
 * offering a selector that cannot be applied.
 */
export interface PermissionState {
  available: boolean;
  /** Selectable presets in catalog order. */
  options: PermissionPresetOption[];
  /** The session's effective value: a preset key or the derived `custom`. */
  preset?: string;
  /** Preset applied to future sessions. */
  defaultPreset?: string;
  /** Sandbox knob behind the effective preset, when resolvable. */
  sandbox?: string;
  /** Approval policy behind the effective preset, when resolvable. */
  approval?: string;
}

/** A decision forwarded to the harness approval answerer. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
