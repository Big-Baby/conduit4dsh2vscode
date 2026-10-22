<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
  import AgentGroup from './components/AgentGroup.vue';
  import ChatHeader from './components/ChatHeader.vue';
  import Composer from './components/Composer.vue';
  import MessageCard from './components/MessageCard.vue';
  import { toggleCard } from './state/cards';
  import { createChatStore } from './state/chat';
  import { useHostBridge } from './composables/useHostBridge';
  import type { ChatCard, InboundMessage, Mention } from './types';

  const { post, onMessage } = useHostBridge();
  const chat = createChatStore(post);
  const state = chat.state;

  const list = ref<HTMLElement | null>(null);
  const composer = ref<InstanceType<typeof Composer> | null>(null);
  const showScrollButton = ref(false);

  /**
   * Scroll compensation for prepended history.
   *
   * Inserting a page above the viewport grows scrollHeight; adding the same
   * delta to scrollTop keeps the reader's position. While set, the card watcher
   * must not jump to the bottom.
   */
  let preservingScroll = false;
  let scrollSnapshot = { height: 0, top: 0 };

  function applyPalette(palette: Record<string, string>): void {
    for (const [key, value] of Object.entries(palette ?? {})) {
      if (value) document.documentElement.style.setProperty(`--dsh-${key}`, value);
    }
  }

  function applyPreferences(): void {
    document.body.classList.toggle('compact', Boolean(state.prefs.compact));
    const width = Number(state.prefs.maxWidth) || 0;
    document.documentElement.style.setProperty('--dsh-max-width', width ? `${width}px` : 'none');
  }

  function scrollToBottom(): void {
    const element = list.value;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }

  /**
   * Whether the reader is parked at the bottom.
   *
   * Live output used to re-pin the transcript on every delta, which made the
   * list impossible to scroll while an agent was running: any upward scroll was
   * snapped back on the next chunk. Following is now opt-in by position.
   */
  function isNearBottom(element: HTMLElement | null = list.value): boolean {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
  }

  function onScroll(): void {
    const element = list.value;
    if (!element) return;
    showScrollButton.value = element.scrollHeight - element.scrollTop - element.clientHeight > 80;
    if (element.scrollTop <= 80) chat.requestHistory();
  }

  /** Fills the viewport so short conversations can still page backwards. */
  function fillViewport(): void {
    const element = list.value;
    if (!element) return;
    if (element.clientHeight <= 0) return;
    if (element.scrollHeight <= element.clientHeight + 8) chat.requestHistory();
  }

  const agents = computed(() => Object.values(state.agents));
  const runningCount = computed(
    () => agents.value.filter((agent) => agent.status === 'running' || agent.status === 'pending' || agent.status === 'waiting').length,
  );
  const title = computed(() => state.session?.title ?? 'DSH');

  watch(
    () => [state.cards.length, state.cards.reduce((total, card) => total + card.text.length, 0)] as const,
    () => {
      if (preservingScroll) return;
      if (!isNearBottom()) {
        showScrollButton.value = true;
        return;
      }
      void nextTick(() => {
        if (preservingScroll || !isNearBottom()) return;
        scrollToBottom();
        onScroll();
      });
    },
  );

  watch(() => state.prefs, applyPreferences, { deep: true });

  onMounted(() => {
    applyPreferences();
    window.addEventListener('keydown', onGlobalKeydown);
    post({ type: 'ready' });
  });

  onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));

  /**
   * Esc stops the running turn.
   *
   * The mention popup owns Esc while it is open, so the two never fire
   * together. Stopping is idempotent: the host cancels an idle session as a
   * no-op.
   */
  function onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !state.running || state.mention.open) return;
    event.preventDefault();
    post({ type: 'stop' });
  }

  onMessage((message: InboundMessage) => {
    if (message.type === 'theme') {
      applyPalette(message.palette);
      return;
    }
    if (message.type === 'copied') {
      composer.value?.flashHint();
      return;
    }

    if (message.type === 'historyPage' && message.messages?.length) {
      const element = list.value;
      scrollSnapshot = { height: element?.scrollHeight ?? 0, top: element?.scrollTop ?? 0 };
      preservingScroll = true;
    }
    if (message.type === 'snapshot') preservingScroll = false;

    chat.applyInbound(message);

    if (message.type === 'prefs') applyPreferences();
    if (message.type === 'snapshot') {
      void nextTick(() => {
        scrollToBottom();
        fillViewport();
      });
    }
    if (message.type === 'historyPage' && preservingScroll) {
      void nextTick(() => {
        const element = list.value;
        if (element) element.scrollTop = scrollSnapshot.top + (element.scrollHeight - scrollSnapshot.height);
        preservingScroll = false;
        onScroll();
        fillViewport();
      });
    }
  });

  /** Explicit jump: also clears the floating button state. */
  function jumpToBottom(): void {
    scrollToBottom();
    showScrollButton.value = false;
    onScroll();
  }

  function onSend(payload: { text: string; mentions?: Mention[] }): void {
    post({ type: 'send', text: payload.text, ...(payload.mentions ? { mentions: payload.mentions } : {}) });
    // Sending is an explicit intent to follow the conversation again.
    void nextTick(scrollToBottom);
  }

  function onSetModel(payload: { modelId: string; effort?: string }): void {
    state.modelId = payload.modelId;
    state.modelPicked = true;
    if (payload.effort !== undefined) state.effort = payload.effort;
    post({
      type: 'setModel',
      modelId: payload.modelId,
      ...(payload.effort !== undefined ? { effort: payload.effort } : {}),
    });
  }

  /** The preset is applied by the harness; reflect it immediately, then confirm. */
  function onSetPermission(preset: string): void {
    state.permission = { ...state.permission, preset };
    post({ type: 'setPermission', preset });
  }

  function onToggle(card: ChatCard): void {
    toggleCard(card);
  }
</script>

<template>
  <ChatHeader
    :title="title"
    :providers="state.providers"
    :model-id="state.modelId"
    :effort="state.effort"
    :permission="state.permission"
    :change-total="state.changes.total"
    :confirmed-at="state.changes.confirmedAt"
    @set-model="onSetModel"
    @set-permission="onSetPermission"
    @confirm-changes="post({ type: 'confirmChanges' })"
    @compare-code="post({ type: 'compareCode' })"
    @collapse-all="post({ type: 'collapseAll', collapsed: true })"
    @expand-all="post({ type: 'expandAll' })"
    @open-ui-settings="post({ type: 'openUiSettings' })"
    @add-provider="post({ type: 'addProvider' })"
    @new-entry="post({ type: 'newEntry' })"
  />

  <div v-if="state.serverMode !== 'live'" class="banner">
    Replay mode: answers are generated locally, no model provider is connected.
  </div>

  <div v-if="agents.length" class="agent-bar">
    <span class="agent-bar-title">
      {{ agents.length }} agent(s)<span v-if="runningCount"> · {{ runningCount }} running</span>
    </span>
    <span
      v-for="agent in agents"
      :key="agent.id"
      class="agent-chip"
      :class="`agent-${agent.status || 'pending'}`"
      :title="`${agent.name || agent.id} (${agent.id})`"
    >
      <span class="agent-dot" />
      {{ agent.name || agent.id }}
    </span>
  </div>

  <div ref="list" class="message-list" @scroll="onScroll">
    <div
      v-if="state.session"
      class="history-hint"
      :class="{ clickable: (state.hasMoreHistory && !state.loadingHistory) || state.historyError }"
      :title="state.hasMoreHistory ? 'Load earlier messages' : 'Start of the conversation'"
      @click="chat.requestHistory({ manual: true })"
    >
      <span v-if="state.loadingHistory" class="spinner" />
      <template v-if="state.loadingHistory">Loading earlier messages…</template>
      <template v-else-if="state.historyError">
        Could not load earlier messages: {{ state.historyError }} (click to retry)
      </template>
      <template v-else-if="state.hasMoreHistory">
        Load earlier messages · {{ state.historyLoaded }} of {{ state.historyTotal }}
      </template>
      <template v-else>Start of the conversation · {{ state.historyTotal }} messages</template>
    </div>

    <MessageCard
      v-for="card in chat.mainCards.value"
      :key="card.key"
      :card="card"
      :show-timestamps="state.prefs.showTimestamps"
      @copy="post({ type: 'copy', text: $event })"
      @toggle="onToggle"
    />

    <AgentGroup
      v-for="group in chat.groups.value"
      :key="group.id"
      :group="group"
      :status="String(state.agents[group.id]?.status ?? 'running')"
      :show-timestamps="state.prefs.showTimestamps"
      @copy="post({ type: 'copy', text: $event })"
      @toggle="onToggle"
      @cancel="post({ type: 'cancelAgent', agentId: $event })"
    />
  </div>

  <Composer
    ref="composer"
    :chat="chat"
    :running="state.running"
    @send="onSend"
    @stop="post({ type: 'stop' })"
  />

  <button v-show="showScrollButton" type="button" class="scroll-bottom" title="Scroll to latest" @click="jumpToBottom">
    ↓
  </button>
</template>
