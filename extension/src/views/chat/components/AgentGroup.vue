<script setup lang="ts">
  import { computed } from 'vue';
  import MessageCard from './MessageCard.vue';
  import type { AgentGroup } from '../state/chat';
  import type { ChatCard } from '../types';

  const props = defineProps<{
    group: AgentGroup;
    status: string;
    showTimestamps: boolean;
  }>();

  const emit = defineEmits<{
    (event: 'copy', text: string): void;
    (event: 'toggle', card: ChatCard): void;
    (event: 'cancel', agentId: string): void;
  }>();

  const active = computed(
    () => props.status === 'running' || props.status === 'pending' || props.status === 'waiting',
  );
</script>

<template>
  <section class="agent-group" :class="`agent-${status}`">
    <header class="agent-head">
      <span class="agent-dot" />
      <span class="agent-name">{{ group.name }}</span>
      <span class="agent-status">{{ status }}</span>
      <span class="card-spacer" />
      <span class="agent-count">{{ group.cards.length }} messages</span>
      <button
        v-if="active"
        type="button"
        class="agent-stop"
        title="Stop this sub-agent"
        @click="emit('cancel', group.id)"
      >
        Stop
      </button>
    </header>
    <div class="agent-body">
      <MessageCard
        v-for="card in group.cards"
        :key="card.key"
        :card="card"
        :show-timestamps="showTimestamps"
        @copy="emit('copy', $event)"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </section>
</template>
