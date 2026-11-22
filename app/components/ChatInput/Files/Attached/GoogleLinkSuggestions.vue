<template>
  <div
    ref="root"
    data-testid="google-link-suggestions"
  >
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="google-link-suggestions-status"
    >
      {{ announcement }}
    </p>
    <div
      v-if="suggestions.length > 0"
      class="flex flex-wrap items-center gap-1.5 px-1 pb-1.5"
      role="group"
      aria-label="Google files from links in your message"
    >
      <div
        v-for="(suggestion, index) in suggestions"
        :key="suggestion.id"
        class="join"
        data-testid="google-link-suggestion"
      >
        <button
          type="button"
          class="js-google-link-attach btn btn-sm btn-soft join-item min-h-11 sm:min-h-8"
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
          @click="dismiss(suggestion.id, index)"
        >
          <Icon
            name="lucide:x"
            size="14"
          />
        </button>
      </div>
      <p
        class="basis-full text-[11px] text-base-content/60"
        data-testid="google-link-suggestions-hint"
      >
        {{ GOOGLE_LINK_PICKER_HINT }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { GOOGLE_DRIVE_LINK_KIND_LABELS } from '#shared/utils/google-drive-links'
import type { DriveLinkSuggestion } from '~/composables/chat-drive-files'

const GOOGLE_LINK_PICKER_HINT = 'If the Picker shows nothing, open the file '
  + 'in Google Drive with the connected account first.'

const props = defineProps<{
  suggestions: readonly DriveLinkSuggestion[]
  isBusy?: boolean
}>()

const emit = defineEmits<{
  accept: [id: string]
  dismiss: [id: string]
}>()

const root = useTemplateRef<HTMLElement>('root')

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

const announcement = computed<string>(() => {
  const count = props.suggestions.length

  if (count === 0) {
    return ''
  }

  const subject = count === 1
    ? 'A Google file link in your message'
    : `${count} Google file links in your message`

  return `${subject} can be attached. ${GOOGLE_LINK_PICKER_HINT}`
})

async function dismiss(id: string, index: number) {
  emit('dismiss', id)
  await nextTick()

  const remaining = root.value?.querySelectorAll<HTMLElement>(
    '.js-google-link-attach',
  )
  const next = remaining?.[Math.min(index, (remaining?.length ?? 1) - 1)]

  if (next) {
    next.focus()

    return
  }

  document.querySelector<HTMLElement>('.js-chat-input-textarea')?.focus()
}
</script>
