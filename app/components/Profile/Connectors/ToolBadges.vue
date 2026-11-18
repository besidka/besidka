<template>
  <span
    v-if="tool.readOnly"
    class="badge badge-soft badge-success badge-sm"
    title="As reported by the server"
  >
    Read-only
  </span>
  <span
    v-else
    class="badge badge-soft badge-warning badge-sm"
  >
    Changes data
  </span>
  <span
    v-if="tool.alwaysAsk"
    class="badge badge-soft badge-error badge-sm"
    title="Besidka asks before every call of this tool"
  >
    Always asks
  </span>
</template>

<script setup lang="ts">
import type { ConnectorReviewTool } from '#shared/types/connectors.d'

defineProps<{
  tool: Pick<ConnectorReviewTool, 'readOnly' | 'alwaysAsk'>
}>()
</script>
