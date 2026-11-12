<template>
  <div
    class="tabs tabs-box max-xs:tabs-xs xs:tabs-sm w-full shrink-0 mb-3 flex-nowrap overflow-x-auto no-scrollbar"
    role="tablist"
    aria-label="Filter generated files by kind"
    data-testid="files-kind-filter"
  >
    <input
      v-for="option in options"
      :key="option.id"
      type="radio"
      name="file_kind_tabs"
      class="tab grow shrink-0 whitespace-nowrap min-h-11 sm:min-h-8"
      :aria-label="option.label"
      :checked="modelValue === option.id"
      :data-testid="option.testId"
      @change="select(option.id)"
    >
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
