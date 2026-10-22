import {
  ErrorCode,
  RpcError,
  createId,
  nowIso,
  type FileMention,
  type MessageInfo,
} from '@conduit4dsh2vscode/protocol';
import { appendJsonLine, readJsonLines } from '../store/json-store';
import { sessionLogFile, type BridgePaths } from '../store/paths';
import type { AppendResult, SessionBackend } from './backend';
import type { SessionEventHub } from './events';

/**
 * Offline backend.
 *
 * Used when the harness agent loop is not available. It stores the transcript
 * locally and answers with a deterministic echo so the RPC surface, the chat
 * UI and the change tracker stay testable without a model provider.
 */
export class ReplayBackend implements SessionBackend {
  readonly mode = 'replay' as const;
  private readonly running = new Set<string>();

  constructor(
    private readonly hub: SessionEventHub,
    private readonly paths: BridgePaths,
  ) {}

  async create(): Promise<void> {
    // Nothing to prepare: the transcript starts empty.
  }

  async readMessages(sessionId: string): Promise<MessageInfo[]> {
    return readJsonLines<MessageInfo>(sessionLogFile(this.paths, sessionId));
  }

  async append(sessionId: string, content: string, mentions?: FileMention[]): Promise<AppendResult> {
    if (this.running.has(sessionId)) {
      throw new RpcError(ErrorCode.SessionBusy, `session is running: ${sessionId}`, { sessionId });
    }

    const messageId = createId('m');
    appendJsonLine(sessionLogFile(this.paths, sessionId), {
      id: messageId,
      role: 'user',
      content,
      ts: nowIso(),
    } satisfies MessageInfo);

    this.running.add(sessionId);
    this.hub.setStatus(sessionId, 'running');
    this.hub.emit(sessionId, 'user.message', { role: 'user', text: content });
    this.hub.emit(sessionId, 'agent.spawn', {
      agent: { id: 'root', kind: 'root', name: 'main', status: 'running' },
    });

    const reference = mentions?.length
      ? `\n\nAttached files:\n${mentions.map((mention) => `- ${mention.path}`).join('\n')}`
      : '';
    const reply =
      `[replay] Received ${content.length} characters. ` +
      'No model provider is connected, so this is a local echo rather than a generated answer.' +
      reference;

    const timer = setTimeout(() => {
      appendJsonLine(sessionLogFile(this.paths, sessionId), {
        id: createId('m'),
        role: 'assistant',
        content: reply,
        ts: nowIso(),
      } satisfies MessageInfo);
      this.hub.emit(sessionId, 'text.delta', { role: 'assistant', text: reply });
      this.hub.emit(sessionId, 'assistant.message', { role: 'assistant', text: reply });
      this.hub.emit(sessionId, 'agent.result', {
        agent: { id: 'root', kind: 'root', name: 'main', status: 'success' },
      });
      this.running.delete(sessionId);
      this.hub.setStatus(sessionId, 'idle');
    }, 30);
    timer.unref?.();

    return { messageId, status: 'running' };
  }

  async cancel(sessionId: string): Promise<void> {
    this.running.delete(sessionId);
    this.hub.setStatus(sessionId, 'idle');
  }

  /** Replay has no live agents: reporting success would be a lie. */
  cancelAgent(): boolean {
    return false;
  }

  async listExtraSessionIds(): Promise<string[]> {
    return [];
  }

  dispose(): void {
    this.running.clear();
  }
}
