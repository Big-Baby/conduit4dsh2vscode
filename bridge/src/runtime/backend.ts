import type {
  AgentNode,
  FileMention,
  MessageInfo,
  SessionBackendMode,
} from '@conduit4dsh2vscode/protocol';

export interface AppendResult {
  messageId: string;
  status: 'running';
}

/**
 * Content backend for a session.
 *
 * Project metadata, titles and archive flags are handled by SessionService;
 * a backend only knows how to talk to a conversation source. This keeps the
 * live harness loop and the offline replay interchangeable.
 */
export interface SessionBackend {
  readonly mode: SessionBackendMode;

  init?(): Promise<void>;

  /** Prepares the underlying conversation; called once per created session. */
  create(sessionId: string, title: string): Promise<void>;

  readMessages(sessionId: string): Promise<MessageInfo[]>;

  append(sessionId: string, content: string, mentions?: FileMention[]): Promise<AppendResult>;

  cancel(sessionId: string): Promise<void>;

  /** Sessions that exist in the source but have no bridge metadata yet. */
  listExtraSessionIds?(): Promise<string[]>;

  agentTree?(sessionId: string): AgentNode[];

  setDefaultEffort?(effort: string | undefined): void;

  selectModel?(sessionId: string, provider: string, model: string, effort?: string): boolean;

  dispose(): void;
}
