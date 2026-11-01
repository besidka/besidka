<template>
  <p
    v-if="outcome && chipState"
    class="mt-2 flex"
  >
    <span
      class="badge badge-sm badge-ghost gap-1 text-base-content/70"
      :data-outcome="outcome"
      :data-searched="chipState.searched"
      data-testid="auto-web-search-chip"
    >
      <Icon
        :name="chipState.icon"
        size="12"
        class="shrink-0"
      />
      <span>{{ chipState.label }}</span>
    </span>
  </p>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  canObserveWebSearch,
  didMessageSearchTheWeb,
  getAutoWebSearchChipState,
  isAutoWebSearchOutcome,
} from '#shared/utils/auto-web-search'
import type {
  AutoWebSearchChipState,
  AutoWebSearchOutcome,
} from '#shared/utils/auto-web-search'
import { getMessageMetadata } from '#shared/utils/message-metadata'

const props = defineProps<{
  message: UIMessage
}>()

const usage = computed(() => {
  return getMessageMetadata(props.message).usage
})

const outcome = computed<AutoWebSearchOutcome | null>(() => {
  const value = usage.value?.autoWebSearch

  return isAutoWebSearchOutcome(value) ? value : null
})

const chipState = computed<AutoWebSearchChipState | null>(() => {
  if (!outcome.value) {
    return null
  }

  return getAutoWebSearchChipState(outcome.value, {
    didSearch: didMessageSearchTheWeb(
      props.message.parts,
      usage.value?.searchUnits,
    ),
    canObserve: canObserveWebSearch(usage.value?.provider),
  })
})
</script>
