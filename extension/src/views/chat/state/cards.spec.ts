import { describe, expect, it } from 'vitest';
import { appendDelta, createCard, mergeFinal, setAllCollapsed, upsertToolCard } from './cards';
import type { ChatCard } from '../types';

describe('streaming cards', () => {
  it('appends deltas to the same card within a turn', () => {
    const cards: ChatCard[] = [];
    appendDelta(cards, { turn: 1, text: 'Hello' });
    appendDelta(cards, { turn: 1, text: ' world' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.text).toBe('Hello world');
    expect(cards[0]?.streaming).toBe(true);
  });

  it('closes a stale streaming card when the turn changes', () => {
    const cards: ChatCard[] = [];
    appendDelta(cards, { turn: 1, text: 'first' });
    appendDelta(cards, { turn: 2, text: 'second' });

    expect(cards).toHaveLength(2);
    expect(cards[0]?.streaming).toBe(false);
    expect(cards[1]?.text).toBe('second');
  });

  it('keeps reasoning separate from the assistant text', () => {
    const cards: ChatCard[] = [];
    appendDelta(cards, { turn: 1, text: 'thinking', reasoning: true });
    appendDelta(cards, { turn: 1, text: 'answer' });

    expect(cards.map((card) => card.kind)).toEqual(['reasoning', 'assistant']);
  });
});

describe('finalizing a message', () => {
  it('refills the streaming card instead of creating a second one', () => {
    const cards: ChatCard[] = [];
    appendDelta(cards, { turn: 1, text: 'partial' });
    mergeFinal(cards, { turn: 1, text: 'partial and complete' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.text).toBe('partial and complete');
    expect(cards[0]?.streaming).toBe(false);
  });

  it('removes a prefix duplicate left by an earlier flush', () => {
    const cards: ChatCard[] = [];
    appendDelta(cards, { turn: 1, text: 'step one' });
    cards[0]!.streaming = false;
    mergeFinal(cards, { turn: 1, text: 'step one plus step two' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.text).toBe('step one plus step two');
  });

  it('creates a card when nothing is streaming', () => {
    const cards: ChatCard[] = [];
    mergeFinal(cards, { turn: 3, text: 'final' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.kind).toBe('assistant');
  });
});

describe('tool cards', () => {
  it('updates the card with the same tool id', () => {
    const cards: ChatCard[] = [];
    upsertToolCard(cards, { id: 't1', name: 'read', args: {}, status: 'running' }, { turn: 1 });
    upsertToolCard(cards, { id: 't1', name: 'read', status: 'success', durationMs: 12 }, { turn: 1 });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.status).toBe('success');
    expect(cards[0]?.meta).toBe('12 ms');
  });
});

describe('bulk folding', () => {
  it('does not collapse a streaming card', () => {
    const cards: ChatCard[] = [createCard({ kind: 'assistant', turn: 1, text: 'a', streaming: true })];
    setAllCollapsed(cards, true);

    expect(cards[0]?.collapsed).toBe(false);
  });
});
