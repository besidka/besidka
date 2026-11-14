<template>
  <div
    class="my-2.5 min-w-0 flex-1"
    :data-state="data.outcome ?? 'running'"
    data-testid="reasoning-connector-step"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <p
        class="min-w-0 break-words text-xs"
        :class="titleClass"
        data-testid="reasoning-connector-step-title"
      >
        {{ title }}{{ pending ? '…' : '' }}
      </p>
      <span
        v-if="data.isFramed"
        class="badge badge-soft badge-xs shrink-0"
        data-testid="reasoning-connector-step-untrusted"
      >
        Untrusted output
      </span>
    </div>
    <details
      v-if="argumentsText"
      class="mt-1 text-xs"
      data-testid="reasoning-connector-step-arguments"
    >
      <summary class="cursor-pointer text-base-content/60">
        Arguments
      </summary>
      <pre
        class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-field bg-base-200 p-2 text-xs"
        data-testid="reasoning-connector-step-arguments-text"
      >{{ argumentsText }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { ConnectorToolCallModel } from '#shared/utils/connectors-parts'
import { formatConnectorArguments } from '~/utils/connector-step'

const props = defineProps<{
  data: ConnectorToolCallModel
  title: string
  pending: boolean
}>()

useConnectorLibrary()

const argumentsText = computed<string>(() => {
  return formatConnectorArguments(props.data.input)
})

const titleClass = computed<string | undefined>(() => {
  if (props.pending) {
    return 'skeleton skeleton-text reasoning-main-title-skeleton'
  }

  return props.data.outcome === 'error' || props.data.outcome === 'denied'
    ? 'text-error/80'
    : undefined
})
</script>
