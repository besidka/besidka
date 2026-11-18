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
        <ChatReasoningStepIcon
          :icon="icon ?? null"
          class="mr-1.5"
        />{{ title }}{{ pending ? '…' : '' }}
      </p>
      <span
        v-if="data.isFramed"
        class="badge badge-soft badge-xs shrink-0"
        data-testid="reasoning-connector-step-untrusted"
      >
        Untrusted output
      </span>
    </div>
    <p
      v-if="failureReason"
      class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-base-content/60"
      data-testid="reasoning-connector-step-reason"
    >
      <span data-testid="reasoning-connector-step-reason-text">
        {{ failureReason }}.
      </span>
      <span data-testid="reasoning-connector-step-reference">
        Reference {{ data.error?.reference }}
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square"
        :aria-label="isReferenceCopied
          ? 'Reference copied'
          : 'Copy reference'"
        data-testid="reasoning-connector-step-copy-reference"
        @click="copyReference"
      >
        <Icon
          :name="isReferenceCopied ? 'lucide:check' : 'lucide:copy'"
          size="12"
          aria-hidden="true"
        />
      </button>
    </p>
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
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'

const props = defineProps<{
  data: ConnectorToolCallModel
  title: string
  pending: boolean
  icon?: ReasoningStepIcon | null
}>()

const COPIED_RESET_MS = 2000

useConnectorLibrary()

const isReferenceCopied = shallowRef<boolean>(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const failureReason = computed<string>(() => {
  const reason = props.data.error?.reason

  if (!reason) {
    return ''
  }

  return reason.charAt(0).toUpperCase() + reason.slice(1)
})

async function copyReference() {
  const reference = props.data.error?.reference

  if (!reference) {
    return
  }

  try {
    await navigator.clipboard.writeText(reference)
    isReferenceCopied.value = true

    if (copiedTimer) {
      clearTimeout(copiedTimer)
    }

    copiedTimer = setTimeout(() => {
      isReferenceCopied.value = false
      copiedTimer = null
    }, COPIED_RESET_MS)
  } catch {
    useErrorMessage('Failed to copy the reference')
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
})

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
