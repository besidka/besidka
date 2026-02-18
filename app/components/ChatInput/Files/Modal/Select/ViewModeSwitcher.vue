<template>
  <div
    role="tablist"
    class="tabs tabs-box tabs-sm shrink-0"
  >
    <label class="tab aspect-square">
      <input
        type="radio"
        name="view_mode"
        :checked="modelValue === 'grid'"
        @change="selectGrid"
      >
      <Icon name="lucide:grid-2x2" class="size-4" />
      <span class="sr-only">Grid</span>
    </label>
    <label class="tab aspect-square">
      <input
        type="radio"
        name="view_mode"
        :checked="modelValue === 'list'"
        @change="selectList"
      >
      <Icon name="lucide:list" class="size-4" />
      <span class="sr-only">List</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import type { ViewMode } from '~/types/file-manager'

defineProps<{
  modelValue: ViewMode
}>()

const emit = defineEmits<{
  'update:modelValue': [mode: ViewMode]
}>()

function selectGrid() {
  emit('update:modelValue', 'grid')
}

function selectList() {
  emit('update:modelValue', 'list')
}
</script>
