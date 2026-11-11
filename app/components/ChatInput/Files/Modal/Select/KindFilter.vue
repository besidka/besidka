<template>
  <div
    class="join w-full shrink-0 mb-3"
    role="group"
    aria-label="Filter generated files by kind"
    data-testid="files-kind-filter"
  >
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="btn btn-sm join-item flex-1 min-h-11 sm:min-h-8"
      :class="{ 'btn-active': modelValue === option.id }"
      :aria-pressed="modelValue === option.id"
      :data-testid="option.testId"
      @click="select(option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { FileKindFilter } from '~/types/file-manager'

const props = defineProps<{
  modelValue: FileKindFilter
}>()

const emit = defineEmits<{
  'update:modelValue': [kind: FileKindFilter]
}>()

const options = fileManagerKindFilterOptions

function select(kind: FileKindFilter): void {
  if (kind === props.modelValue) {
    return
  }

  emit('update:modelValue', kind)
}
</script>
