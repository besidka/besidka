<template>
  <div
    v-if="options.length"
    class="tabs tabs-box max-xs:tabs-xs xs:tabs-sm w-full shrink-0 flex-nowrap overflow-x-auto no-scrollbar"
    role="tablist"
    :aria-label="label"
    :data-testid="`${testIdPrefix}-filter`"
  >
    <input
      v-for="option in options"
      :key="option.value"
      type="radio"
      :name="`${testIdPrefix}_tabs`"
      class="tab grow shrink-0 whitespace-nowrap min-h-11 sm:min-h-8"
      :aria-label="option.label"
      :checked="modelValue === option.value"
      :data-testid="`${testIdPrefix}-${option.value}`"
      @change="select(option.value)"
    >
  </div>
</template>

<script setup lang="ts">
import type { DocumentFilterOption } from '~/composables/documents-library'

const props = defineProps<{
  options: Array<DocumentFilterOption<string>>
  modelValue: string
  label: string
  testIdPrefix: string
}>()

const emit = defineEmits<{
  select: [value: string]
}>()

function select(value: string): void {
  if (value === props.modelValue) {
    return
  }

  emit('select', value)
}
</script>
