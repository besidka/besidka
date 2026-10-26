<template>
  <p
    v-if="outcome"
    class="mt-2 flex"
  >
    <span
      class="badge badge-sm badge-ghost gap-1 text-base-content/70"
      :data-outcome="outcome"
      data-testid="auto-web-search-chip"
    >
      <Icon
        :name="didSearch ? 'lucide:globe' : 'lucide:circle-slash-2'"
        size="12"
        class="shrink-0"
      />
      <span>{{ label }}</span>
    </span>
  </p>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  didAutoWebSearchSearch,
  getAutoWebSearchChipLabel,
  isAutoWebSearchOutcome,
} from '#shared/utils/auto-web-search'
import type { AutoWebSearchOutcome } from '#shared/utils/auto-web-search'
import { getMessageMetadata } from '#shared/utils/message-metadata'

const props = defineProps<{
  message: UIMessage
}>()

const outcome = computed<AutoWebSearchOutcome | null>(() => {
  const value = getMessageMetadata(props.message).usage?.autoWebSearch

  return isAutoWebSearchOutcome(value) ? value : null
})

const didSearch = computed<boolean>(() => {
  return outcome.value ? didAutoWebSearchSearch(outcome.value) : false
})

const label = computed<string>(() => {
  return outcome.value ? getAutoWebSearchChipLabel(outcome.value) : ''
})
</script>
