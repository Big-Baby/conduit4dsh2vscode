import type {
  AgentInfo,
  AgentNode,
  ApprovalOutcome,
  BundleItem,
  DefaultModelSelection,
  HistoryPage,
  PermissionState,
  MessageInfo,
  ModelInfo,
  PluginChangeResult,
  PluginEventParams,
  PluginInspectResult,
  PluginItem,
  PluginTargetKind,
  ProjectInfo,
  ProviderInfo,
  ProviderSyncInput,
  ProviderSyncResult,
  RegistrySearchResult,
  ServerInfo,
  SessionDetail,
  SessionInfo,
  WorkspaceFileList,
  WorkspaceSummary,
  FileMention,
} from './models';

/**
 * One entry per RPC method.
 *
 * The map is the single source of truth for method names, parameter shapes and
 * result shapes. Implementations are checked against it at compile time.
 */
export interface MethodMap {
  'system.ping': { params: Record<string, never>; result: { pong: true } };
  'system.info': { params: Record<string, never>; result: ServerInfo };
  'system.shutdown': {
    params: Record<string, never>;
    result: { ok: true; mode: 'process-exit' | 'server-stop' };
  };

  'workspace.list': { params: Record<string, never>; result: WorkspaceSummary[] };

  'project.list': { params: Record<string, never>; result: ProjectInfo[] };
  'project.ensure': { params: { name: string; path: string }; result: ProjectInfo };
  'project.remove': { params: { projectId: string }; result: { ok: true } };

  'session.list': {
    params: { projectId?: string; includeArchived?: boolean };
    result: SessionInfo[];
  };
  'session.get': { params: { sessionId: string }; result: SessionDetail };
  'session.history': {
    params: { sessionId: string; before?: string; limit?: number };
    result: HistoryPage;
  };
  'session.create': {
    params: { projectId: string; title?: string; initialEntry?: string };
    result: SessionInfo;
  };
  'session.append': {
    params: { sessionId: string; content: string; attachments?: FileMention[] };
    result: { messageId: string; status: 'running' };
  };
  'session.cancel': { params: { sessionId: string }; result: { ok: true } };
  'session.rename': { params: { sessionId: string; title: string }; result: { ok: true } };
  'session.fork': { params: { sessionId: string; fromMessageId?: string }; result: SessionInfo };
  'session.archive': { params: { sessionId: string }; result: { ok: true } };
  'session.unarchive': { params: { sessionId: string }; result: { ok: true } };
  'session.delete': { params: { sessionId: string }; result: { ok: true } };

  'model.providers.list': { params: Record<string, never>; result: ProviderInfo[] };
  'model.providers.add': {
    params: {
      id?: string;
      kind: string;
      baseURL?: string;
      apiKey?: string;
      models?: Array<Pick<ModelInfo, 'id' | 'name' | 'inputTypes'>>;
    };
    result: ProviderInfo;
  };
  'model.providers.sync': {
    params: { providers?: ProviderSyncInput[]; replace?: boolean; defaultModel?: string };
    result: ProviderSyncResult;
  };
  'model.providers.setKey': {
    params: { providerId: string; apiKey: string };
    result: { ok: true };
  };
  'model.providers.remove': { params: { providerId: string }; result: { ok: true } };
  'model.list': { params: { providerId?: string }; result: ModelInfo[] };
  'model.getDefault': { params: Record<string, never>; result: DefaultModelSelection };
  'model.setDefault': {
    params: { modelId: string; sessionId?: string; effort?: string };
    result: { ok: true };
  };

  'agent.list': { params: { sessionId: string }; result: AgentInfo[] };
  'agent.tree': { params: { sessionId: string }; result: AgentNode[] };
  'agent.get': { params: { sessionId: string; agentId: string }; result: AgentInfo };
  'agent.cancel': { params: { sessionId: string; agentId: string }; result: { ok: true } };

  /**
   * Permission presets. `sessionId` is optional so a client can read the
   * catalog before opening a session; without it the result carries the
   * process catalog and the default only.
   */
  'permission.get': { params: { sessionId?: string }; result: PermissionState };
  'permission.set': { params: { sessionId: string; preset: string }; result: PermissionState };
  /**
   * Answers a pending harness approval question. The bridge fails closed: an
   * unanswered or unknown request is reported as `unavailable` to the harness,
   * so the blocked tool action never runs.
   */
  'approval.respond': {
    params: { requestId: string; outcome: Exclude<ApprovalOutcome, 'unavailable' | 'cancelled'> };
    result: { ok: true };
  };

  'file.readText': { params: { path: string }; result: { path: string; content: string } };
  'file.list': {
    params: { query?: string; maxFiles?: number };
    result: WorkspaceFileList;
  };
  'file.stat': {
    params: { path: string };
    result: { path: string; size: number; mtime: number; isDirectory: boolean };
  };

  'plugin.list': { params: Record<string, never>; result: { plugins: PluginItem[]; bundles: BundleItem[] } };
  'plugin.registry.search': {
    params: { query: string; size?: number };
    result: RegistrySearchResult;
  };
  'plugin.registry.inspect': { params: { spec: string }; result: PluginInspectResult };
  'plugin.install': { params: { spec: string }; result: { requestId: string } };
  'plugin.install.cancel': { params: { requestId: string }; result: { status: string } };
  'plugin.uninstall': { params: { name: string }; result: PluginChangeResult };
  'plugin.setEnabled': {
    params: { kind: PluginTargetKind; id: string; enabled: boolean };
    result: PluginChangeResult;
  };

  'config.get': { params: { keys?: string[] }; result: Record<string, unknown> };
  'config.set': {
    params: { patch: Record<string, unknown> };
    result: { ok: true; applied: string[]; config: Record<string, unknown> };
  };
}

export type MethodName = keyof MethodMap;
export type MethodParams<M extends MethodName> = MethodMap[M]['params'];
export type MethodResult<M extends MethodName> = MethodMap[M]['result'];

export type MethodHandler<M extends MethodName> = (
  params: MethodParams<M>,
) => Promise<MethodResult<M>> | MethodResult<M>;

/**
 * Complete handler table. Being a mapped type over `MethodName`, adding a
 * method to the contract fails the build until it is implemented.
 */
export type MethodHandlers = { [M in MethodName]: MethodHandler<M> };

/** Payload accepted by the `plugin.event` notification. */
export type PluginEventPayload = PluginEventParams;

/** Convenience type used by the client snapshot handler. */
export type SessionMessage = MessageInfo;
