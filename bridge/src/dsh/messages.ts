import type { MessageInfo, MessageRole } from '@conduit4dsh2vscode/protocol';
import { loadHarnessExport } from './module-loader';
import type { InstallModelSelection } from './model-selection';

export type CreateUserMessage = (input: { content: unknown[]; source: { kind: string } }) => unknown;

export interface RawEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: unknown;
}

export async function loadCreateUserMessage(): Promise<CreateUserMessage | undefined> {
  return loadHarnessExport<CreateUserMessage>('dsh-llm', 'createUserMessage');
}

export async function loadInstallModelSelection(): Promise<InstallModelSelection | undefined> {
  return loadHarnessExport<InstallModelSelection>('dsh-agent', 'installModelSelection');
}

/**
 * Rebuilds the visible conversation from harness surface events.
 *
 * Only events that represent a message are mapped; turn/step plumbing is not
 * part of the transcript.
 */
export function messagesFromEvents(events: RawEvent[]): MessageInfo[] {
  const messages: MessageInfo[] = [];

  for (const event of events) {
    if (!event.type) continue;

    let role: MessageRole | undefined;
    let payload: unknown = event.data;

    switch (event.type) {
      case 'user/message':
        role = 'user';
        break;
      case 'assistant/message':
        role = 'assistant';
        payload = (event.data as { message?: unknown } | undefined)?.message;
        break;
      case 'tool/result':
        role = 'tool';
        payload = (event.data as { message?: unknown } | undefined)?.message;
        break;
      case 'system/message':
      case 'developer/message':
        role = 'system';
        payload = (event.data as { message?: unknown } | undefined)?.message;
        break;
      default:
        continue;
    }

    const text = extractText(payload);
    if (!text) continue;

    messages.push({
      id: `m_${event.seq ?? messages.length}`,
      role,
      content: text,
      ts: new Date(event.time ?? Date.now()).toISOString(),
    });
  }

  return messages;
}

/** Message content is either a string or an array of typed parts. */
export function extractText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => ((part as { type?: string }).type === 'text' ? String((part as { text?: string }).text ?? '') : ''))
    .join('')
    .trim();
}

/**
 * Turns rate-limit failures into an actionable message.
 *
 * Reaching this point means the harness already exhausted its provider-level
 * retries, so the user needs context rather than a raw JSON payload.
 */
export function formatAgentError(raw: string): string {
  if (!/\b429\b|rate.?limit|too many requests|1302/i.test(raw)) return raw;
  return [
    'HTTP 429: the provider rate limit was hit after the automatic retry budget was exhausted.',
    'Check the requests-per-minute and tokens-per-minute quotas for this key,',
    'then retry, switch models, or reduce concurrent sessions.',
    '',
    `Provider response: ${raw}`,
  ].join('\n');
}
