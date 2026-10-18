import { computed, reactive } from 'vue';
import * as cardOps from './cards';
import { absolutePathOf, computeCandidates } from '../lib/fuzzy';
import { firstLine, lineCount } from '../lib/markdown';
import type {
  AgentInfo,
  ChatCard,
  FileEntry,
  HistoryMessage,
  InboundMessage,
  Mention,
  OutboundMessage,
  ProviderInfo,
  SessionEvent,
  SessionInfo,
} from '../types';

export interface UiPrefs {
  collapseLongMessages: boolean;
  collapseThresholdLines: number;
  collapseReasoning: boolean;
  collapseToolResults: boolean;
  showTimestamps: boolean;
  compact: boolean;
  maxWidth: number;
}

const DEFAULT_PREFS: UiPrefs = {
  collapseLongMessages: true,
  collapseThresholdLines: 14,
  collapseReasoning: true,
  collapseToolResults: true,
  showTimestamps: true,
  compact: false,
  maxWidth: 860,
};

export interface AgentGroup {
  id: string;
  name: string;
  cards: ChatCard[];
}

function flatten(nodes: AgentInfo[]): AgentInfo[] {
  const out: AgentInfo[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children?.length) out.push(...flatten(node.children));
  }
  return out;
}

/**
 * Conversation state.
 *
 * Cards are the single source of truth: streaming updates locate a card by
 * container, turn and streaming flag rather than by querying the DOM.
 */
export function createChatStore(post: (message: OutboundMessage) => void) {
  const state = reactive({
    session: null as SessionInfo | null,
    providers: [] as ProviderInfo[],
    modelId: '',
    modelPicked: false,
    effort: '',
    running: false,
    /** Incremented by every user message. */
    turn: 0,
    cards: [] as ChatCard[],
    agents: {} as Record<string, AgentInfo>,
    changes: { total: 0, confirmedAt: '' },
    prefs: { ...DEFAULT_PREFS } as UiPrefs,
    serverMode: 'replay' as 'live' | 'replay',
    files: [] as FileEntry[],
    filesLoaded: false,
    filesLoading: false,
    filesError: '',
    mentions: [] as Mention[],
    mention: { open: false, query: '', index: 0, start: -1, candidates: [] as FileEntry[] },
    hasMoreHistory: false,
    loadingHistory: false,
    historyError: '',
    historyTotal: 0,
    historyLoaded: 0,
  });

  const mainCards = computed(() => state.cards.filter((card) => cardOps.containerOf(card.agentId) === ''));

  const groups = computed<AgentGroup[]>(() => {
    const grouped = new Map<string, ChatCard[]>();
    for (const card of state.cards) {
      const id = cardOps.containerOf(card.agentId);
      if (!id) continue;
      const existing = grouped.get(id);
      if (existing) existing.push(card);
      else grouped.set(id, [card]);
    }
    return [...grouped.entries()].map(([id, cards]) => ({
      id,
      name: state.agents[id]?.name ?? id,
      cards,
    }));
  });

  function autoCollapse(): { enabled: boolean; threshold: number } {
    return {
      enabled: state.prefs.collapseLongMessages,
      threshold: state.prefs.collapseThresholdLines,
    };
  }

  function cardsFromHistory(messages: HistoryMessage[]): ChatCard[] {
    return messages.map((message) => {
      const text = message.content ?? '';
      const collapse =
        state.prefs.collapseLongMessages && lineCount(text) > state.prefs.collapseThresholdLines;
      const card = cardOps.createCard({
        kind: (message.role as ChatCard['kind']) ?? 'assistant',
        turn: 0,
        text,
        ...(message.ts !== undefined ? { ts: message.ts } : {}),
        ...(collapse ? { collapsed: true, subtitle: firstLine(text) } : {}),
      });
      if (message.id) card.key = `m_${message.id}`;
      return card;
    });
  }

  function trackAgent(ref: SessionEvent['agent']): void {
    if (!ref?.id) return;
    const previous: Partial<AgentInfo> = state.agents[ref.id] ?? {};
    state.agents[ref.id] = {
      ...previous,
      id: ref.id,
      name: ref.name ?? previous.name ?? ref.id,
      kind: ref.kind ?? previous.kind,
      status: ref.status ?? previous.status ?? 'running',
    };
  }

  /**
   * Hot-swaps the provider list.
   *
   * A model chosen by the user survives; if it disappeared, fall back to the
   * host default and then to the first available model.
   */
  function applyProviders(providers: ProviderInfo[], defaultModelId?: string): void {
    state.providers = providers;
    const ids = providers.flatMap((provider) => provider.models.map((model) => model.id));
    const has = (id?: string): boolean => Boolean(id) && ids.includes(id as string);

    if (state.modelPicked && has(state.modelId)) return;
    if (has(defaultModelId)) {
      state.modelId = defaultModelId as string;
      return;
    }
    state.modelId = ids[0] ?? '';
  }

  function note(text: string, agentId?: string, kind: 'system' | 'error' = 'system'): void {
    state.cards.push(
      cardOps.createCard({
        kind,
        turn: state.turn,
        ...(agentId ? { agentId } : {}),
        text,
      }),
    );
  }

  function applyEvent(event: SessionEvent): void {
    trackAgent(event.agent);
    const agentId = event.agent?.id;
    const ts = event.ts;

    switch (event.type) {
      case 'user.message': {
        state.turn += 1;
        const text = event.text ?? '';
        const collapse =
          state.prefs.collapseLongMessages && lineCount(text) > state.prefs.collapseThresholdLines;
        state.cards.push(
          cardOps.createCard({
            kind: 'user',
            turn: state.turn,
            ...(agentId ? { agentId } : {}),
            text,
            ...(ts !== undefined ? { ts } : {}),
            ...(collapse ? { collapsed: true, subtitle: firstLine(text) } : {}),
          }),
        );
        break;
      }

      case 'assistant.message':
        cardOps.mergeFinal(state.cards, {
          ...(agentId ? { agentId } : {}),
          turn: state.turn,
          text: event.text ?? '',
          ...(ts !== undefined ? { ts } : {}),
          autoCollapse: autoCollapse(),
        });
        break;

      case 'text.delta':
        cardOps.appendDelta(state.cards, {
          ...(agentId ? { agentId } : {}),
          turn: state.turn,
          text: event.text ?? '',
          ...(ts !== undefined ? { ts } : {}),
        });
        break;

      case 'reasoning.delta':
        cardOps.appendDelta(state.cards, {
          ...(agentId ? { agentId } : {}),
          turn: state.turn,
          text: event.text ?? '',
          reasoning: true,
          ...(ts !== undefined ? { ts } : {}),
        });
        break;

      case 'tool.call':
      case 'tool.result':
        if (event.tool) {
          cardOps.upsertToolCard(state.cards, event.tool, {
            ...(agentId ? { agentId } : {}),
            turn: state.turn,
            ...(ts !== undefined ? { ts } : {}),
          });
        }
        break;

      case 'agent.spawn':
      case 'agent.status':
      case 'agent.result': {
        const status = event.agent?.status;
        // Only reasoning is closed here; the assistant card is refilled by the
        // assistant.message event that follows.
        if (event.type !== 'agent.spawn' && (status === 'success' || status === 'error' || status === 'cancelled')) {
          cardOps.finalizeStreaming(state.cards, agentId, ['reasoning']);
        }
        const name = event.agent?.name ?? event.agent?.id ?? 'agent';
        note(event.text ?? `${name}: ${status ?? 'updated'}`, agentId);
        break;
      }

      case 'error':
        note(event.text ?? 'Unknown error', agentId, 'error');
        break;

      default:
        break;
    }
  }

  function applyInbound(message: InboundMessage): void {
    switch (message.type) {
      case 'snapshot': {
        state.session = message.session;
        state.providers = message.providers ?? [];
        state.modelId = message.modelId ?? '';
        state.effort = message.effort ?? '';
        state.running = message.session?.status === 'running';
        state.turn = 0;
        state.cards = cardsFromHistory(message.messages ?? []);
        state.agents = {};
        clearHistoryTimer();
        state.hasMoreHistory = Boolean(message.hasMoreHistory);
        state.historyTotal = Number(message.historyTotal ?? state.cards.length);
        state.historyLoaded = state.cards.length;
        state.loadingHistory = false;
        state.historyError = '';
        for (const agent of flatten(message.agents ?? [])) state.agents[agent.id] = agent;
        break;
      }

      case 'historyPage': {
        clearHistoryTimer();
        state.loadingHistory = false;
        if (typeof message.total === 'number' && message.total > 0) state.historyTotal = message.total;
        if (message.error) {
          // Keep hasMore so the user can retry.
          state.historyError = message.error;
          break;
        }

        state.historyError = '';
        state.hasMoreHistory = Boolean(message.hasMore);
        const page = message.messages ?? [];
        if (!page.length) break;

        const known = new Set(state.cards.map((card) => card.key));
        const fresh = cardsFromHistory(page).filter((card) => !known.has(card.key));
        if (fresh.length) {
          state.cards.unshift(...fresh);
          state.historyLoaded += fresh.length;
        }
        break;
      }

      case 'event':
        applyEvent(message.event);
        break;

      case 'providers':
        applyProviders(message.providers ?? [], message.defaultModelId);
        break;

      case 'state': {
        const wasRunning = state.running;
        state.running = message.status === 'running';
        if (wasRunning && !state.running) cardOps.finalizeStreaming(state.cards);
        break;
      }

      case 'agent': {
        const agent = message.agent;
        if (agent?.id) state.agents[agent.id] = { ...(state.agents[agent.id] ?? {}), ...agent };
        break;
      }

      case 'changes':
        state.changes = { total: message.total ?? 0, confirmedAt: message.confirmedAt ?? '' };
        break;

      case 'prefs':
        state.prefs = { ...DEFAULT_PREFS, ...(message.prefs ?? {}) } as UiPrefs;
        break;

      case 'serverMode':
        state.serverMode = message.mode === 'live' ? 'live' : 'replay';
        break;

      case 'collapseAll':
        cardOps.setAllCollapsed(state.cards, message.collapsed);
        break;

      case 'expandAll':
        cardOps.setAllCollapsed(state.cards, false);
        break;

      case 'fileList':
        state.files = message.files ?? [];
        state.filesError = message.error ?? '';
        state.filesLoaded = true;
        state.filesLoading = false;
        if (state.mention.open) {
          state.mention.candidates = computeCandidates(state.files, state.mention.query);
        }
        break;

      case 'error':
        note(message.message, undefined, 'error');
        break;

      default:
        break;
    }
  }

  /* ------------------------------ @ mentions ------------------------------ */

  function openMention(query: string, start: number): void {
    state.mention.open = true;
    state.mention.query = query;
    state.mention.start = start;
    state.mention.index = 0;

    if (!state.filesLoaded && !state.filesLoading) {
      state.filesLoading = true;
      post({ type: 'listFiles' });
    }
    state.mention.candidates = computeCandidates(state.files, query);
  }

  function closeMention(): void {
    if (!state.mention.open) return;
    state.mention.open = false;
    state.mention.query = '';
    state.mention.index = 0;
    state.mention.candidates = [];
  }

  function moveMention(delta: number): void {
    const count = state.mention.candidates.length;
    if (!count) return;
    state.mention.index = (state.mention.index + delta + count) % count;
  }

  /** An `@` token is active when no whitespace follows it before the caret. */
  function updateMentionTrigger(value: string, caret: number): void {
    let index = caret - 1;
    while (index >= 0) {
      const char = value[index];
      if (char === '@') break;
      if (/\s/.test(char ?? '')) {
        closeMention();
        return;
      }
      index -= 1;
    }
    if (index < 0) {
      closeMention();
      return;
    }
    openMention(value.slice(index + 1, caret), index);
  }

  function confirmMention(value: string, caret: number): { value: string; cursor: number } | undefined {
    const pick = state.mention.candidates[state.mention.index];
    if (!pick) {
      closeMention();
      return undefined;
    }

    const token = `@${pick.path} `;
    const next = value.slice(0, state.mention.start) + token + value.slice(caret);
    const cursor = state.mention.start + token.length;
    const absolute = absolutePathOf(pick);

    if (!state.mentions.some((mention) => mention.path === absolute)) {
      state.mentions.push({ path: absolute, name: pick.name, token });
    }
    closeMention();
    return { value: next, cursor };
  }

  function removeMention(path: string): string | undefined {
    const hit = state.mentions.find((mention) => mention.path === path);
    state.mentions = state.mentions.filter((mention) => mention.path !== path);
    return hit?.token;
  }

  /* ------------------------------ history paging ------------------------------ */

  let historyTimer: ReturnType<typeof setTimeout> | undefined;

  function clearHistoryTimer(): void {
    if (historyTimer === undefined) return;
    clearTimeout(historyTimer);
    historyTimer = undefined;
  }

  /**
   * Requests one earlier page.
   *
   * Automatic triggers stay silent when a previous attempt failed, so scrolling
   * cannot hammer a failing endpoint; the manual path retries once.
   */
  function requestHistory(options: { manual?: boolean } = {}): void {
    if (state.loadingHistory) return;
    const manual = options.manual === true;
    if (!manual && (state.historyError || !state.hasMoreHistory)) return;
    if (manual && !state.hasMoreHistory && !state.historyError) return;

    state.loadingHistory = true;
    state.historyError = '';
    post({ type: 'history' });

    clearHistoryTimer();
    historyTimer = setTimeout(() => {
      historyTimer = undefined;
      if (!state.loadingHistory) return;
      state.loadingHistory = false;
      state.historyError = 'Request timed out';
    }, 10_000);
  }

  return {
    state,
    mainCards,
    groups,
    applyInbound,
    applyEvent,
    requestHistory,
    updateMentionTrigger,
    confirmMention,
    moveMention,
    closeMention,
    removeMention,
    setAllCollapsed: (collapsed: boolean) => cardOps.setAllCollapsed(state.cards, collapsed),
    finalizeStreaming: () => cardOps.finalizeStreaming(state.cards),
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
