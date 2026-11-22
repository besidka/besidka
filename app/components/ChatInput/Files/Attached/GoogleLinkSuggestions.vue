<template>
  <div
    v-if="suggestions.length > 0"
    class="flex flex-wrap items-center gap-1.5 px-1 pb-1.5"
    role="group"
    aria-label="Google files from links in your message"
    aria-live="polite"
    data-testid="google-link-suggestions"
  >
    <div
      v-for="(suggestion, index) in suggestions"
      :key="suggestion.id"
      class="join"
      data-testid="google-link-suggestion"
    >
      <button
        type="button"
        class="btn btn-sm btn-soft join-item min-h-11 sm:min-h-8"
        :disabled="isBusy"
        data-testid="google-link-suggestion-attach"
        @click="emit('accept', suggestion.id)"
      >
        <Icon
          :name="GOOGLE_DRIVE_ICON"
          size="16"
        />
        {{ labels[index] }}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-soft join-item min-h-11 sm:min-h-8"
        :aria-label="`Dismiss: ${labels[index]}`"
        title="Dismiss"
        data-testid="google-link-suggestion-dismiss"
        @click="emit('dismiss', suggestion.id)"
      >
        <Icon
          name="lucide:x"
          size="14"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { GOOGLE_DRIVE_LINK_KIND_LABELS } from '#shared/utils/google-drive-links'
import type { DriveLinkSuggestion } from '~/composables/chat-drive-files'

const props = defineProps<{
  suggestions: readonly DriveLinkSuggestion[]
  isBusy?: boolean
}>()

const emit = defineEmits<{
  accept: [id: string]
  dismiss: [id: string]
}>()

const labels = computed<string[]>(() => {
  if (props.suggestions.length === 1) {
    return ['Attach this Google file']
  }

  const totals = new Map<string, number>()
  const seen = new Map<string, number>()

  for (const suggestion of props.suggestions) {
    totals.set(suggestion.kind, (totals.get(suggestion.kind) ?? 0) + 1)
  }

  return props.suggestions.map((suggestion) => {
    const kindLabel = GOOGLE_DRIVE_LINK_KIND_LABELS[suggestion.kind]
    const ordinal = (seen.get(suggestion.kind) ?? 0) + 1

    seen.set(suggestion.kind, ordinal)

    return (totals.get(suggestion.kind) ?? 0) > 1
      ? `Attach this ${kindLabel} (${ordinal})`
      : `Attach this ${kindLabel}`
  })
})
</script>
