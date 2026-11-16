<template>
  <div class="flex px-4 pb-2">
    <div
      class="flex max-w-full flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-1.5 text-sm shadow-sm"
      role="status"
      data-testid="connector-suggestion"
    >
      <Icon
        name="lucide:plug"
        class="size-4 shrink-0 text-base-content/70"
        aria-hidden="true"
      />
      <span
        class="min-w-0"
        data-testid="connector-suggestion-text"
      >
        {{ title }} is off in this chat. Turn it on?
      </span>
      <span class="flex shrink-0 gap-1">
        <button
          type="button"
          class="btn btn-xs btn-primary min-h-8"
          :disabled="isSaving || isAtLimit"
          :title="isAtLimit ? limitHint : undefined"
          data-testid="connector-suggestion-turn-on"
          @click="emit('turn-on')"
        >
          Turn on
        </button>
        <button
          type="button"
          class="btn btn-xs btn-ghost min-h-8"
          :disabled="isSaving"
          data-testid="connector-suggestion-dismiss"
          @click="emit('dismiss')"
        >
          Not now
        </button>
      </span>
      <span
        v-if="isAtLimit"
        class="w-full text-xs text-warning"
        data-testid="connector-suggestion-limit"
      >
        {{ limitHint }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CONNECTORS_PER_SEND } from '#shared/utils/connectors-policy'

withDefaults(defineProps<{
  title: string
  isAtLimit?: boolean
  isSaving?: boolean
}>(), {
  isAtLimit: false,
  isSaving: false,
})

const emit = defineEmits<{
  'turn-on': []
  'dismiss': []
}>()

const limitHint = `A chat can use at most ${CONNECTORS_PER_SEND} connectors. `
  + 'Turn one off first.'
</script>
