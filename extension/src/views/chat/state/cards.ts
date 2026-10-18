import { firstLine, lineCount } from '../lib/markdown';
import type { CardKind, ChatCard, ToolCall } from '../types';

const DEFAULT_TITLE: Record<CardKind, string> = {
  user: 'You',
  assistant: 'DSH',
  system: 'System',
  error: 'Error',
  reasoning: 'Reasoning',
  tool: 'Tool',
};

let sequence = 0;

export function nextKey(): string {
  sequence += 1;
  return `c${sequence}_${Date.now().toString(36)}`;
}

export interface CardInit {
  kind: CardKind;
  turn: number;
  agentId?: string;
  title?: string;
  text?: string;
  ts?: number | string;
  streaming?: boolean;
  collapsed?: boolean;
  meta?: string;
  subtitle?: string;
  status?: string;
  tool?: ToolCall;
}

export function createCard(init: CardInit): ChatCard {
  return {
    key: nextKey(),
    kind: init.kind,
    title: init.title ?? DEFAULT_TITLE[init.kind],
    text: init.text ?? '',
    collapsed: init.collapsed ?? false,
    streaming: init.streaming ?? false,
    turn: init.turn,
    agentId: init.agentId ?? '',
    ...(init.ts !== undefined ? { ts: init.ts } : {}),
    ...(init.meta ? { meta: init.meta } : {}),
    ...(init.subtitle ? { subtitle: init.subtitle } : {}),
    ...(init.status ? { status: init.status } : {}),
    ...(init.tool ? { tool: init.tool } : {}),
  };
}

/** `''` and `'root'` both address the main transcript. */
export function containerOf(agentId: string | undefined): string {
  const value = agentId ?? '';
  return value === 'root' ? '' : value;
}

function isReasoning(card: ChatCard): boolean {
  return card.kind === 'reasoning';
}

function findStreaming(cards: ChatCard[], agentId: string | undefined, reasoning: boolean): ChatCard | undefined {
  const target = containerOf(agentId);
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (!card?.streaming) continue;
    if (isReasoning(card) !== reasoning) continue;
    if (containerOf(card.agentId) !== target) continue;
    return card;
  }
  return undefined;
}

/**
 * Appends a streaming delta.
 *
 * A streaming card from an earlier turn is closed instead of being appended
 * to: reconnects can deliver a delta after the turn boundary was lost.
 */
export function appendDelta(
  cards: ChatCard[],
  options: {
    agentId?: string;
    turn: number;
    text: string;
    reasoning?: boolean;
    ts?: number | string;
  },
): ChatCard {
  const reasoning = options.reasoning === true;
  let card = findStreaming(cards, options.agentId, reasoning);

  if (card && card.turn !== options.turn) {
    card.streaming = false;
    card = undefined;
  }

  if (!card) {
    card = createCard({
      kind: reasoning ? 'reasoning' : 'assistant',
      turn: options.turn,
      agentId: options.agentId,
      ...(options.ts !== undefined ? { ts: options.ts } : {}),
      streaming: true,
    });
    cards.push(card);
  }

  card.text += options.text;
  return card;
}

function lastTurnCard(cards: ChatCard[], agentId: string | undefined, turn: number): ChatCard | undefined {
  const target = containerOf(agentId);
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (!card || card.kind !== 'assistant' || card.turn !== turn) continue;
    if (containerOf(card.agentId) !== target) continue;
    if (!card.text) continue;
    return card;
  }
  return undefined;
}

/** Removes partial duplicates left by a step-level message flush. */
function dropPrefixDuplicates(cards: ChatCard[], keep: ChatCard, text: string): void {
  const target = containerOf(keep.agentId);
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (!card || card === keep || card.kind !== 'assistant') continue;
    if (card.turn !== keep.turn) continue;
    if (containerOf(card.agentId) !== target) continue;
    if (card.text && text.startsWith(card.text)) cards.splice(index, 1);
  }
}

/**
 * Finalizes a message: refill the streaming card when possible, otherwise merge
 * into the last card of the turn. Never creates a duplicate.
 */
export function mergeFinal(
  cards: ChatCard[],
  options: {
    agentId?: string;
    turn: number;
    text: string;
    ts?: number | string;
    autoCollapse?: { enabled: boolean; threshold: number };
  },
): ChatCard {
  let target = findStreaming(cards, options.agentId, false);
  if (target && target.turn !== options.turn) target = undefined;
  if (target) target.streaming = false;
  if (!target) target = lastTurnCard(cards, options.agentId, options.turn);

  const shouldCollapse =
    options.autoCollapse?.enabled === true && lineCount(options.text) > (options.autoCollapse.threshold ?? 14);

  if (target) {
    dropPrefixDuplicates(cards, target, options.text);
    target.text = options.text;
    target.collapsed = shouldCollapse;
    target.subtitle = shouldCollapse ? firstLine(options.text) : undefined;
    return target;
  }

  const card = createCard({
    kind: 'assistant',
    turn: options.turn,
    agentId: options.agentId,
    text: options.text,
    ...(options.ts !== undefined ? { ts: options.ts } : {}),
    ...(shouldCollapse ? { collapsed: true, subtitle: firstLine(options.text) } : {}),
  });
  cards.push(card);
  return card;
}

/** Closes streaming cards, optionally limited to one agent and set of kinds. */
export function finalizeStreaming(cards: ChatCard[], agentId?: string, kinds?: CardKind[]): void {
  const allowed = kinds ? new Set(kinds) : undefined;
  for (const card of cards) {
    if (!card.streaming) continue;
    if (agentId !== undefined && containerOf(card.agentId) !== containerOf(agentId)) continue;
    if (allowed && !allowed.has(card.kind)) continue;
    card.streaming = false;
  }
}

/** Upserts a tool card; arguments stream in, so the same id is updated in place. */
export function upsertToolCard(
  cards: ChatCard[],
  tool: ToolCall,
  options: { agentId?: string; turn: number; ts?: number | string },
): ChatCard {
  const target = containerOf(options.agentId);
  const sameId = cards.filter(
    (card) => card.kind === 'tool' && card.tool && String(card.tool.id ?? '') === String(tool.id ?? ''),
  );
  // The streaming delta and the durable result can disagree on the agent
  // container (the result event is session-scoped), so fall back to the id.
  const existing = sameId.find((card) => containerOf(card.agentId) === target) ?? sameId[0];

  if (existing && existing.tool) {
    existing.tool = mergeTool(existing.tool, tool);
    if (tool.status) existing.status = tool.status;
    if (tool.durationMs !== undefined) existing.meta = `${tool.durationMs} ms`;
    return existing;
  }

  const card = createCard({
    kind: 'tool',
    turn: options.turn,
    agentId: options.agentId,
    title: tool.name || 'Tool',
    status: tool.status,
    tool,
    ...(options.ts !== undefined ? { ts: options.ts } : {}),
    ...(tool.durationMs !== undefined ? { meta: `${tool.durationMs} ms` } : {}),
  });
  cards.push(card);
  return card;
}

/**
 * Merges a later event into an existing tool record.
 *
 * Partial events (the result carries neither name nor arguments) must not blank
 * fields the streaming update already filled in.
 */
function mergeTool(previous: ToolCall, next: ToolCall): ToolCall {
  return {
    ...previous,
    ...(next.id ? { id: next.id } : {}),
    ...(next.name ? { name: next.name } : {}),
    ...(next.args !== undefined ? { args: next.args } : {}),
    ...(next.status ? { status: next.status } : {}),
    ...(next.result !== undefined ? { result: next.result } : {}),
    ...(next.durationMs !== undefined ? { durationMs: next.durationMs } : {}),
  };
}

export function toggleCard(card: ChatCard): void {
  card.collapsed = !card.collapsed;
}

/** Bulk folding skips streaming cards: work in progress stays visible. */
export function setAllCollapsed(cards: ChatCard[], collapsed: boolean): void {
  for (const card of cards) {
    if (card.streaming) continue;
    card.collapsed = collapsed;
  }
}
