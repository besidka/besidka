<template>
  <fieldset
    class="grid gap-2"
    data-testid="knowledge-mode"
  >
    <legend class="mb-1 text-sm font-semibold">
      How Besidka uses the knowledge
    </legend>
    <div
      class="
        rounded-box border border-base-content/15 divide-y
        divide-base-content/10
      "
    >
      <label
        v-for="option in options"
        :key="option.mode"
        class="flex cursor-pointer items-start gap-3 p-3"
        :class="{ 'cursor-not-allowed opacity-60': disabled }"
      >
        <input
          type="radio"
          class="radio radio-sm mt-1"
          :name="groupName"
          :value="option.mode"
          :checked="modelValue === option.mode"
          :disabled="disabled"
          :data-testid="`knowledge-mode-${option.mode}`"
          @change="emit('select', option.mode)"
        >
        <span class="grid min-w-0 gap-1">
          <span class="font-bold">{{ option.label }}</span>
          <span class="text-sm text-base-content/70">
            {{ option.description }}
          </span>
        </span>
      </label>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import type { KnowledgeMode } from '#shared/types/project-knowledge.d'

interface ModeOption {
  mode: KnowledgeMode
  label: string
  description: string
}

defineProps<{
  modelValue: KnowledgeMode
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [mode: KnowledgeMode]
}>()

const groupName = `knowledge-mode-${useId()}`

const options: ModeOption[] = [
  {
    mode: 'auto',
    label: 'Auto',
    description: 'Sends everything when it fits the model\'s budget, and '
      + 'lets the model search the files when it does not.',
  },
  {
    mode: 'full',
    label: 'Always include everything',
    description: 'Sends every file with every message. The most thorough, '
      + 'but you pay for all of it on each message (much less when the '
      + 'provider caches it).',
  },
  {
    mode: 'search',
    label: 'Always search',
    description: 'The model looks files up only when it needs them. The '
      + 'cheapest per message, but it can miss files it never searches.',
  },
]
</script>
