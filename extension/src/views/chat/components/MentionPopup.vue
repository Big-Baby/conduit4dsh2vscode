<script setup lang="ts">
  import type { FileEntry } from '../types';

  defineProps<{
    candidates: FileEntry[];
    index: number;
    query: string;
    loading: boolean;
    loaded: boolean;
    error: string;
  }>();

  const emit = defineEmits<{
    (event: 'pick', index: number): void;
  }>();
</script>

<template>
  <div class="mention-popup">
    <div v-if="loading && !loaded" class="mention-empty">Loading workspace files…</div>
    <div v-else-if="error" class="mention-empty">{{ error }}</div>
    <div v-else-if="!candidates.length" class="mention-empty">
      {{ query ? 'No matching file' : 'No files' }}
    </div>
    <button
      v-for="(candidate, position) in candidates"
      :key="candidate.path"
      type="button"
      class="mention-item"
      :class="{ active: position === index }"
      :title="candidate.path"
      @mousedown.prevent="emit('pick', position)"
    >
      <span class="mention-path">{{ candidate.path }}</span>
      <span class="mention-size">{{ Math.max(1, Math.round(candidate.size / 1024)) }} KB</span>
    </button>
  </div>
</template>
