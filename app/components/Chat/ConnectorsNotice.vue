<template>
  <ul
    v-if="lines.length > 0"
    class="mb-2 flex flex-col gap-0.5 text-xs text-base-content/60"
    data-testid="connectors-notice"
  >
    <li
      v-for="line in lines"
      :key="line"
      class="flex items-start gap-1"
      data-testid="connectors-notice-line"
    >
      <Icon
        name="lucide:cable"
        size="12"
        class="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <span class="min-w-0 break-words">{{ line }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import { getConnectorNoticeLines } from '#shared/utils/connectors-parts'

const props = defineProps<{
  message: UIMessage
}>()

const lines = computed<string[]>(() => {
  return getConnectorNoticeLines(props.message)
})
</script>
