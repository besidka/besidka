<template>
  <div
    v-if="options.length"
    role="group"
    :aria-label="label"
    class="flex flex-wrap gap-1.5"
    :data-testid="`${testIdPrefix}-filter`"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="btn btn-sm"
      :class="modelValue === option.value ? 'btn-accent' : 'btn-soft'"
      :aria-pressed="modelValue === option.value"
      :data-testid="`${testIdPrefix}-${option.value}`"
      @click="emit('select', option.value)"
    >
      {{ option.label }}
      <span
        class="badge badge-xs badge-soft"
        :data-testid="`${testIdPrefix}-${option.value}-count`"
      >
        {{ option.count }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
export interface FilterButtonOption<Value extends string = string> {
  value: Value
  label: string
  count: number
}

defineProps<{
  options: Array<FilterButtonOption>
  modelValue: string
  label: string
  testIdPrefix: string
}>()

const emit = defineEmits<{
  select: [value: string]
}>()
</script>
