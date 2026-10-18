<script setup lang="ts">
  import MessageCard from './MessageCard.vue';
  import type { AgentGroup } from '../state/chat';
  import type { ChatCard } from '../types';

  defineProps<{
    group: AgentGroup;
    status: string;
    showTimestamps: boolean;
  }>();

  const emit = defineEmits<{
    (event: 'copy', text: string): void;
    (event: 'toggle', card: ChatCard): void;
  }>();
</script>

<template>
  <section class="agent-group" :class="`agent-${status}`">
    <header class="agent-head">
      <span class="agent-dot" />
      <span class="agent-name">{{ group.name }}</span>
      <span class="agent-status">{{ status }}</span>
      <span class="card-spacer" />
      <span class="agent-count">{{ group.cards.length }} messages</span>
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
