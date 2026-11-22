<template>
  <div
    v-if="view"
    class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-base-content/70"
    role="status"
    aria-live="polite"
    data-testid="chat-tool-rounds"
  >
    <span
      v-if="view.kind === 'running'"
      class="inline-flex items-center gap-2"
      data-testid="chat-tool-rounds-running"
    >
      <span
        class="loading loading-dots loading-xs"
        aria-hidden="true"
      />
      Working through a long task · round {{ view.round }} of
      {{ view.maxRounds }}
    </span>
    <template v-else-if="view.kind === 'paused'">
      <span data-testid="chat-tool-rounds-paused">
        Paused after round {{ view.round }} of {{ view.maxRounds }}.
      </span>
      <button
        type="button"
        class="btn btn-sm btn-soft"
        data-testid="chat-tool-rounds-continue"
        @click="controller?.continueRound()"
      >
        Continue
      </button>
    </template>
    <template v-else>
      <span data-testid="chat-tool-rounds-limit">
        This task used all {{ view.maxRounds }} rounds one message can run.
      </span>
      <button
        type="button"
        class="btn btn-sm btn-soft"
        data-testid="chat-tool-rounds-continue-new"
        @click="controller?.continueAsNewMessage()"
      >
        Continue
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  TOOL_ROUNDS_PER_MESSAGE,
  readEndingToolBudget,
} from '#shared/utils/tool-rounds'

type ToolRoundsView
  = | { kind: 'running', round: number, maxRounds: number }
    | { kind: 'paused', round: number, maxRounds: number }
    | { kind: 'limit', round: number, maxRounds: number }

const props = defineProps<{
  message: UIMessage
  isLast: boolean
}>()

const controller = useToolRoundController()

const view = computed<ToolRoundsView | null>(() => {
  if (!controller || !props.isLast) {
    return null
  }

  const activeRound = controller.activeRound.value

  if (controller.isRequestActive.value) {
    return activeRound > 0
      ? {
        kind: 'running',
        round: activeRound,
        maxRounds: TOOL_ROUNDS_PER_MESSAGE,
      }
      : null
  }

  const budget = readEndingToolBudget(props.message.parts)

  if (!budget) {
    return null
  }

  if (budget.round >= budget.maxRounds) {
    return { kind: 'limit', round: budget.round, maxRounds: budget.maxRounds }
  }

  const next = { messageId: props.message.id, round: budget.round + 1 }

  if (!controller.isWaitingForUser.value && controller.isRequested(next)) {
    return null
  }

  return { kind: 'paused', round: budget.round, maxRounds: budget.maxRounds }
})
</script>
