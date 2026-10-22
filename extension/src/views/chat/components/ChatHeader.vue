<script setup lang="ts">
  import { computed } from 'vue';
  import type { PermissionState, ProviderInfo } from '../types';

  const props = defineProps<{
    title: string;
    providers: ProviderInfo[];
    modelId: string;
    effort: string;
    permission: PermissionState;
    changeTotal: number;
    confirmedAt: string;
  }>();

  const emit = defineEmits<{
    (event: 'setModel', payload: { modelId: string; effort?: string }): void;
    (event: 'setPermission', preset: string): void;
    (event: 'confirmChanges'): void;
    (event: 'compareCode'): void;
    (event: 'collapseAll'): void;
    (event: 'expandAll'): void;
    (event: 'openUiSettings'): void;
    (event: 'newEntry'): void;
    (event: 'addProvider'): void;
  }>();

  const EFFORTS = [
    { value: '', label: 'Effort: default' },
    { value: 'low', label: 'Effort: low' },
    { value: 'medium', label: 'Effort: medium' },
    { value: 'high', label: 'Effort: high' },
  ];

  const changeLabel = computed(() =>
    props.changeTotal > 0 ? `Changes (${props.changeTotal})` : 'Changes',
  );

  // A provider can be registered but still expose no models; both cases mean the
  // picker cannot offer anything, so they share the same prompt.
  const hasModels = computed(() =>
    props.providers.some((provider) => provider.models.length > 0),
  );

  const changeTitle = computed(() =>
    props.confirmedAt
      ? `Last confirmed: ${props.confirmedAt}\nReview and confirm pending changes`
      : 'Review and confirm changes since the last confirmation',
  );

  // The harness may report a derived `custom` state that is not selectable; it
  // labels the control but never appears as an option.
  const permissionLabel = computed(() => {
    const current = props.permission.preset ?? 'unknown';
    const parts = [`Permission: ${current}`];
    if (props.permission.sandbox) parts.push(`sandbox: ${props.permission.sandbox}`);
    if (props.permission.approval) parts.push(`approval: ${props.permission.approval}`);
    parts.push('Changes apply to this session immediately');
    return parts.join('\n');
  });

  const permissionDanger = computed(() => props.permission.preset === 'danger-full-access');

  function onModel(event: Event): void {
    emit('setModel', { modelId: (event.target as HTMLSelectElement).value });
  }

  function onEffort(event: Event): void {
    // Only the effort changes; the model id stays as-is.
    emit('setModel', { modelId: props.modelId, effort: (event.target as HTMLSelectElement).value });
  }

  function onPermission(event: Event): void {
    const preset = (event.target as HTMLSelectElement).value;
    if (preset) emit('setPermission', preset);
  }
</script>

<template>
  <header class="chat-header">
    <span class="chat-title" :title="title">{{ title }}</span>

    <select
      v-if="hasModels"
      class="model-picker"
      :value="modelId"
      title="Model for this session"
      @change="onModel"
    >
      <optgroup v-for="provider in providers" :key="provider.id" :label="provider.id">
        <option v-for="model in provider.models" :key="model.id" :value="model.id">
          {{ model.name }}
        </option>
      </optgroup>
    </select>

    <button
      v-else
      type="button"
      class="model-picker model-picker-empty"
      title="No provider configured yet. Click to add one."
      @click="emit('addProvider')"
    >
      No model — add provider
    </button>

    <select class="effort-picker" :value="effort" title="Reasoning effort" @change="onEffort">
      <option v-for="option in EFFORTS" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>

    <select
      v-if="permission.available && permission.options.length"
      class="permission-picker"
      :class="{ 'permission-danger': permissionDanger }"
      :value="permission.preset ?? ''"
      :title="permissionLabel"
      @change="onPermission"
    >
      <option v-if="!permission.preset" value="" disabled>Permission: unknown</option>
      <option v-else-if="!permission.options.some((option) => option.value === permission.preset)" :value="permission.preset" disabled>
        Permission: {{ permission.preset }} (custom)
      </option>
      <option v-for="option in permission.options" :key="option.value" :value="option.value">
        {{ option.name }}
      </option>
    </select>

    <button type="button" class="btn btn-warn" :title="changeTitle" @click="emit('confirmChanges')">
      {{ changeLabel }}
    </button>
    <button type="button" class="btn" title="Compare pending changes against the baseline" @click="emit('compareCode')">
      Compare
    </button>

    <button type="button" class="icon-button" title="Collapse all" @click="emit('collapseAll')">▤</button>
    <button type="button" class="icon-button" title="Expand all" @click="emit('expandAll')">▥</button>
    <button type="button" class="icon-button" title="Appearance settings" @click="emit('openUiSettings')">⚙</button>
    <button type="button" class="btn" @click="emit('newEntry')">New</button>
  </header>
</template>
