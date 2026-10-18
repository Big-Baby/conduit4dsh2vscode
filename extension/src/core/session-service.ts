import type {
  FileMention,
  HistoryPage,
  MessageInfo,
  SessionDetail,
  SessionInfo,
} from '@conduit4dsh2vscode/protocol';
import type { DshClient } from '../rpc/client';

/** Typed facade over the session-related RPC methods. */
export class SessionService {
  constructor(private readonly client: () => DshClient) {}

  list(projectId?: string, includeArchived = false): Promise<SessionInfo[]> {
    return this.client().request<SessionInfo[]>('session.list', {
      ...(projectId ? { projectId } : {}),
      includeArchived,
    });
  }

  get(sessionId: string): Promise<SessionDetail> {
    return this.client().request<SessionDetail>('session.get', { sessionId });
  }

  history(sessionId: string, before: string | undefined, limit: number): Promise<HistoryPage> {
    return this.client().request<HistoryPage>('session.history', {
      sessionId,
      ...(before ? { before } : {}),
      limit,
    });
  }

  create(projectId: string, title: string): Promise<SessionInfo> {
    return this.client().request<SessionInfo>('session.create', { projectId, title });
  }

  append(sessionId: string, content: string, mentions?: FileMention[]): Promise<{ messageId: string; status: 'running' }> {
    return this.client().request('session.append', {
      sessionId,
      content,
      ...(mentions?.length ? { attachments: mentions } : {}),
    });
  }

  cancel(sessionId: string): Promise<{ ok: true }> {
    return this.client().request('session.cancel', { sessionId });
  }

  rename(sessionId: string, title: string): Promise<{ ok: true }> {
    return this.client().request('session.rename', { sessionId, title });
  }

  fork(sessionId: string, fromMessageId?: string): Promise<SessionInfo> {
    return this.client().request<SessionInfo>('session.fork', {
      sessionId,
      ...(fromMessageId ? { fromMessageId } : {}),
    });
  }

  archive(sessionId: string): Promise<{ ok: true }> {
    return this.client().request('session.archive', { sessionId });
  }

  unarchive(sessionId: string): Promise<{ ok: true }> {
    return this.client().request('session.unarchive', { sessionId });
  }

  remove(sessionId: string): Promise<{ ok: true }> {
    return this.client().request('session.delete', { sessionId });
  }

  /** Convenience for callers that only need the transcript. */
  async messages(sessionId: string): Promise<MessageInfo[]> {
    const detail = await this.get(sessionId);
    return detail.messages;
  }
}
