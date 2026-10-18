<script setup lang="ts">
  import { computed } from 'vue';
  import { firstLine, renderMarkdown } from '../lib/markdown';
  import { formatTime } from '../lib/time';
  import type { ChatCard } from '../types';

  const props = defineProps<{
    card: ChatCard;
    showTimestamps: boolean;
  }>();

  const emit = defineEmits<{
    (event: 'copy', text: string): void;
    (event: 'toggle', card: ChatCard): void;
  }>();

  const html = computed(() => renderMarkdown(props.card.text));
  const subtitle = computed(
    () => props.card.subtitle || (props.card.kind === 'tool' ? toolSummary.value : firstLine(props.card.text)),
  );

  /** One-line preview of what the tool was asked to do. */
  const toolSummary = computed(() => {
    const args = props.card.tool?.args;
    if (typeof args === 'string') return firstLine(args.replace(/\s+/g, ' ').trim());
    if (args && typeof args === 'object') {
      const record = args as Record<string, unknown>;
      for (const key of ['command', 'cmd', 'path', 'file_path', 'query', 'pattern', 'url', 'description']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return firstLine(value.replace(/\s+/g, ' ').trim());
      }
      try {
        return firstLine(JSON.stringify(args));
      } catch {
        return '';
      }
    }
    return props.card.text;
  });

  const argsText = computed(() => {
    const args = props.card.tool?.args;
    return args === undefined ? '' : formatArgs(args);
  });

  const resultText = computed(() => {
    const result = props.card.tool?.result;
    return result === undefined ? '' : formatResult(result);
  });

  function stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /**
   * Arguments arrive as a fragment of JSON, so a half-written `{` or `"comm`
   * must not be printed: it reads as corruption. Show a placeholder until the
   * payload parses, then pretty-print it.
   */
  function formatArgs(value: unknown): string {
    if (typeof value !== 'string') return stringify(value);
    const trimmed = value.trim();
    if (!trimmed) return '(waiting for arguments…)';
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return '(receiving arguments…)';
    }
  }

  /**
   * Tool output is arbitrary bytes: `file` on an archive dumps the raw header,
   * which used to fill the card with hundreds of U+FFFD glyphs. Lines that are
   * mostly undecodable are collapsed, readable lines are kept, and the whole
   * block is capped so one runaway command cannot dominate the transcript.
   */
  const MAX_RESULT_LINES = 40;
  const MAX_LINE_CHARS = 400;

  function formatResult(value: unknown): string {
    const text = stringify(value);
    if (!text) return '(empty)';
    const lines = text.split('\n');
    const shown = lines.slice(0, MAX_RESULT_LINES).map(cleanLine);
    if (lines.length > MAX_RESULT_LINES) {
      shown.push(`… ${lines.length - MAX_RESULT_LINES} more line(s) not shown`);
    }
    return shown.join('\n');
  }

  function cleanLine(line: string): string {
    if (!line) return line;
    if (isBinaryLine(line)) return `(binary data · ${line.length} chars)`;
    return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
  }

  function isBinaryLine(line: string): boolean {
    let bad = 0;
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      const control = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
      if (code === 0xfffd || control) bad += 1;
    }
    return bad / line.length > 0.2;
  }
</script>

<template>
  <article
    class="card"
    :class="[`card-${card.kind}`, { collapsed: card.collapsed, streaming: card.streaming }]"
    :data-kind="card.kind"
  >
    <header class="card-head" @click="emit('toggle', card)">
      <span class="card-dot" />
      <span class="card-title">{{ card.title }}</span>
      <span v-if="card.meta" class="card-meta">{{ card.meta }}</span>
      <span v-if="card.status" class="card-status" :class="`status-${card.status}`">{{ card.status }}</span>
      <span class="card-spacer" />
      <time v-if="showTimestamps" class="card-time">{{ formatTime(card.ts) }}</time>
      <button
        v-if="!card.streaming && card.text"
        type="button"
        class="icon-button"
        title="Copy message"
        @click.stop="emit('copy', card.text)"
      >
        ⧉
      </button>
      <button
        type="button"
        class="icon-button"
        :title="card.collapsed ? 'Expand' : 'Collapse'"
        @click.stop="emit('toggle', card)"
      >
        {{ card.collapsed ? '▸' : '▾' }}
      </button>
    </header>

    <div v-if="card.collapsed" class="card-subtitle">{{ subtitle }}</div>
    <div v-else class="card-body">
      <div v-if="card.kind === 'tool'" class="tool-body">
        <template v-if="argsText || resultText">
          <section v-if="argsText" class="tool-section">
            <h4 class="tool-label">arguments</h4>
            <pre class="tool-block">{{ argsText }}</pre>
          </section>
          <section v-if="resultText" class="tool-section">
            <h4 class="tool-label">result</h4>
            <pre class="tool-block">{{ resultText }}</pre>
          </section>
        </template>
        <pre v-else class="tool-block">{{ card.text || '(no payload)' }}</pre>
      </div>
      <div v-else class="markdown" v-html="html" />
      <span v-if="card.streaming" class="caret" />
    </div>
  </article>
</template>
