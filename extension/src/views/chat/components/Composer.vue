<script setup lang="ts">
  import { computed, nextTick, ref } from 'vue';
  import MentionPopup from './MentionPopup.vue';
  import type { ChatStore } from '../state/chat';
  import type { Mention } from '../types';

  const props = defineProps<{
    chat: ChatStore;
    running: boolean;
  }>();

  const emit = defineEmits<{
    (event: 'send', payload: { text: string; mentions?: Mention[] }): void;
    (event: 'stop'): void;
  }>();

  const draft = ref('');
  const textarea = ref<HTMLTextAreaElement | null>(null);
  const hint = ref('');
  const copied = ref(false);

  const mention = computed(() => props.chat.state.mention);
  const chips = computed(() => props.chat.state.mentions);

  function autoGrow(): void {
    const element = textarea.value;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }

  function refreshHint(): void {
    const length = draft.value.length;
    hint.value = length ? `${length} characters` : '';
  }

  function onInput(): void {
    autoGrow();
    refreshHint();
    props.chat.updateMentionTrigger(draft.value, textarea.value?.selectionStart ?? 0);
  }

  function applyMention(): void {
    const element = textarea.value;
    if (!element) return;
    const result = props.chat.confirmMention(draft.value, element.selectionStart ?? 0);
    if (!result) return;

    draft.value = result.value;
    void nextTick(() => {
      element.setSelectionRange(result.cursor, result.cursor);
      autoGrow();
      refreshHint();
      element.focus();
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (mention.value.open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        props.chat.moveMention(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        props.chat.moveMention(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applyMention();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        props.chat.closeMention();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function send(): void {
    const text = draft.value.trim();
    if (!text || props.running) return;

    const mentions = chips.value.map((mention) => ({ path: mention.path, name: mention.name }));
    emit('send', { text, ...(mentions.length ? { mentions } : {}) });

    draft.value = '';
    props.chat.state.mentions = [];
    void nextTick(() => {
      autoGrow();
      refreshHint();
    });
  }

  function pick(index: number): void {
    props.chat.state.mention.index = index;
    applyMention();
  }

  function removeChip(path: string): void {
    const token = props.chat.removeMention(path);
    if (token) draft.value = draft.value.replace(token, '');
    void nextTick(() => {
      autoGrow();
      refreshHint();
    });
  }

  function onBlur(): void {
    // Let the popup's mousedown handler run before closing.
    window.setTimeout(() => props.chat.closeMention(), 150);
  }

  defineExpose({
    flashHint: () => {
      copied.value = true;
      window.setTimeout(() => (copied.value = false), 1200);
    },
  });
</script>

<template>
  <div class="composer">
    <div v-if="chips.length" class="mention-chips">
      <span v-for="chip in chips" :key="chip.path" class="mention-chip" :title="chip.path">
        <span class="mention-chip-label">{{ chip.name || chip.path }}</span>
        <button type="button" class="mention-chip-remove" title="Remove" @click="removeChip(chip.path)">×</button>
      </span>
    </div>

    <div class="composer-wrap">
      <MentionPopup
        v-if="mention.open"
        :candidates="mention.candidates"
        :index="mention.index"
        :query="mention.query"
        :loading="chat.state.filesLoading"
        :loaded="chat.state.filesLoaded"
        :error="chat.state.filesError"
        @pick="pick"
      />
      <textarea
        ref="textarea"
        v-model="draft"
        class="composer-input"
        rows="1"
        placeholder="Send a message. Use @ to attach a file."
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>

    <div class="composer-bar">
      <span class="composer-hint">
        {{ copied ? 'Copied to clipboard' : hint || 'Enter to send · Shift+Enter for a new line' }}
      </span>
      <span class="card-spacer" />
      <button type="button" class="btn btn-primary" :disabled="running || !draft.trim()" @click="send">Send</button>
      <button v-if="running" type="button" class="btn btn-danger" @click="emit('stop')">Stop</button>
    </div>
  </div>
</template>
