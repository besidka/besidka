<template>
  <fieldset
    class="grid min-w-0 m-0 p-0 border border-base-300 rounded-box overflow-hidden"
    :style="{
      gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
    }"
    :aria-labelledby="labelledby"
  >
    <legend class="sr-only">
      {{ legend }}
    </legend>
    <label
      v-for="(option, index) in options"
      :key="option.value"
      class="relative block min-w-0"
      :class="{ 'border-l border-base-300': index > 0 }"
      :title="option.title"
    >
      <input
        type="radio"
        class="peer absolute inset-0 m-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        :name="name"
        :value="option.value"
        :checked="modelValue === option.value"
        :disabled="disabled || option.disabled"
        :aria-label="option.title ?? option.label"
        :data-testid="option.testId"
        @change="emit('update:modelValue', option.value)"
      >
      <span
        class="flex flex-col items-center justify-center gap-px min-h-8 max-md:min-h-10 px-1 py-0.5 text-xs font-medium whitespace-nowrap peer-[:hover:not(:checked):not(:disabled)]:bg-base-200 peer-checked:bg-accent peer-checked:text-accent-content peer-disabled:opacity-50 peer-disabled:bg-transparent peer-checked:peer-disabled:bg-base-content/15 peer-checked:peer-disabled:text-base-content peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-accent"
      >
        <span class="truncate max-w-full">{{ option.label }}</span>
        <small
          v-if="option.sub"
          class="text-[10px] leading-none opacity-80"
        >
          {{ option.sub }}
        </small>
      </span>
    </label>
  </fieldset>
</template>

<script setup lang="ts" generic="Value extends string">
import type { SegmentedOption } from '~/types/chat-input-tools'

defineProps<{
  name: string
  legend: string
  options: SegmentedOption<Value>[]
  modelValue: Value
  disabled?: boolean
  labelledby?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Value]
}>()
</script>
