import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { UIMessage } from 'ai'
import type { ReasoningApprovalStep } from '~/types/reasoning-step.d'
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'
import type {
  ApprovalStepModel,
  ApprovalStepState,
} from '~/utils/tool-approval-step'
import { isAwaitingApprovalToolPart } from '#shared/utils/tool-approval-parts'
import { CONNECTOR_TOOL_NAME_PREFIX } from '#shared/utils/connectors-policy'
import { resolveReasoningStepSource } from '~/utils/reasoning-step-icons'
import {
  formatApprovalOutcome,
  formatApprovalProgress,
  getApprovalDataByToolCallId,
  getApprovalReasonText,
  getApprovalSourceLabel,
  getApprovalStepModel,
  getApprovalStepSummaryLine,
  getApprovalStepTitle,
  resolveApprovalStepState,
} from '~/utils/tool-approval-step'

export interface MessageApprovalEntry {
  partIndex: number
  model: ApprovalStepModel
  state: ApprovalStepState
}

export interface MessageApprovalView {
  id: string
  title: string
  icon: ReasoningStepIcon
  approval: ReasoningApprovalStep
}

export const AWAITING_APPROVAL_STEP_STATES: ReadonlySet<ApprovalStepState>
  = new Set<ApprovalStepState>(['pending', 'answered', 'sending'])

/**
 * The approvals of one assistant message. The reasoning steps and the
 * approval bubble under the message each call it and build the state from
 * the same parts and controller refs, so both show the same state, and
 * only the bubble renders the answer buttons. The bubble holds the calls
 * that wait for an answer and, on the last message, the ones whose answer
 * failed in this session (with Ask again). It reads only whether the
 * message is the last one, not the whole message list, so a streamed chunk
 * of another message does not recompute it.
 */
export function useMessageApprovals(
  message: MaybeRefOrGetter<UIMessage>,
  options: { isShared?: MaybeRefOrGetter<boolean | undefined> } = {},
) {
  const controller = useToolApprovalController()
  const { titlesBySlug, connectorsBySlug } = useConnectorTitles()

  const parts = computed<UIMessage['parts']>(() => {
    return toValue(message).parts
  })

  const isActive = computed<boolean>(() => {
    return toValue(message).role === 'assistant'
      && (controller?.isActive.value ?? false)
  })

  const isLastMessage = computed<boolean>(() => {
    return controller?.messages.value.at(-1)?.id === toValue(message).id
  })

  const entries: ComputedRef<Map<number, MessageApprovalEntry>> = computed(
    () => {
      const result = new Map<number, MessageApprovalEntry>()

      if (!isActive.value || !controller) {
        return result
      }

      const dataByToolCallId = getApprovalDataByToolCallId(parts.value)
      const models: Array<{
        partIndex: number
        model: ApprovalStepModel
      }> = []

      for (const [partIndex, part] of parts.value.entries()) {
        const model = getApprovalStepModel(part, dataByToolCallId)

        if (model) {
          models.push({ partIndex, model })
        }
      }

      const isEveryCallAnswered = models
        .filter(({ model }) => {
          return isAwaitingApprovalToolPart({
            type: 'dynamic-tool',
            state: model.partState,
          })
        })
        .every(({ model }) => {
          return model.partState === 'approval-responded'
        })
      const context = {
        isLastMessage: isLastMessage.value,
        sendingApprovalIds: new Set(controller.sendingApprovalIds.value),
        answeredApprovalIds: new Set(controller.answeredApprovalIds.value),
        failures: controller.failures.value,
        isEveryCallAnswered,
      }

      for (const { partIndex, model } of models) {
        result.set(partIndex, {
          partIndex,
          model,
          state: resolveApprovalStepState(model, context),
        })
      }

      return result
    },
  )

  const pendingApprovalIds = computed<string[]>(() => {
    return [...entries.value.values()].flatMap((entry) => {
      return entry.state === 'pending' ? [entry.model.approvalId] : []
    })
  })

  const awaitingEntries = computed<MessageApprovalEntry[]>(() => {
    return [...entries.value.values()].filter((entry) => {
      return AWAITING_APPROVAL_STEP_STATES.has(entry.state)
    })
  })

  function isBubbleEntry(entry: MessageApprovalEntry): boolean {
    if (AWAITING_APPROVAL_STEP_STATES.has(entry.state)) {
      return true
    }

    return isLastMessage.value
      && !!controller?.failures.value[entry.model.approvalId]
  }

  const bubbleEntries = computed<MessageApprovalEntry[]>(() => {
    return [...entries.value.values()].filter(isBubbleEntry)
  })

  function getConnectorName(entry: MessageApprovalEntry): string {
    const connectorSlug = entry.model.connectorSlug

    return connectorSlug
      ? titlesBySlug.value.get(connectorSlug) || connectorSlug
      : ''
  }

  function buildApprovalStep(
    entry: MessageApprovalEntry,
  ): ReasoningApprovalStep {
    const awaiting = awaitingEntries.value
    const answeredCount = awaiting.filter((item) => {
      return item.state !== 'pending'
    }).length
    const isLastAwaiting = awaiting.at(-1)?.partIndex === entry.partIndex
    const sourceLabel = getApprovalSourceLabel(
      parts.value,
      entry.partIndex,
      titlesBySlug.value,
    )

    return {
      model: entry.model,
      state: entry.state,
      connectorName: getConnectorName(entry),
      reasonText: getApprovalReasonText(
        entry.model.reason,
        sourceLabel,
        entry.model.toolName,
      ),
      summaryLine: getApprovalStepSummaryLine(entry.model),
      progress: isLastAwaiting && entry.state !== 'sending'
        ? formatApprovalProgress(answeredCount, awaiting.length)
        : '',
      outcome: entry.state === 'denied' || entry.state === 'approved'
        ? formatApprovalOutcome(
          entry.state,
          controller?.answeredAt.value[entry.model.approvalId],
        )
        : '',
      isInBubble: isBubbleEntry(entry),
    }
  }

  function buildApprovalView(
    entry: MessageApprovalEntry,
  ): MessageApprovalView {
    const approval = buildApprovalStep(entry)
    const { model } = entry
    const source = resolveReasoningStepSource({
      toolName: model.connectorSlug
        ? `${CONNECTOR_TOOL_NAME_PREFIX}${model.connectorSlug}__${model.tool}`
        : model.toolName,
      title: getApprovalStepTitle(
        model,
        model.connectorSlug
          ? titlesBySlug.value.get(model.connectorSlug)
          : undefined,
      ),
      connectorId: model.connectorSlug
        ? connectorsBySlug.value.get(model.connectorSlug)?.id
        : undefined,
      connectorTitle: approval.connectorName,
      searchProvider: getMessageMetadata(toValue(message)).usage
        ?.searchProvider,
      allowConnectorIcon: !toValue(options.isShared),
    })

    return {
      id: `tool-${model.toolCallId || entry.partIndex}`,
      title: source.label,
      icon: source.icon,
      approval,
    }
  }

  const bubbleViews = computed<MessageApprovalView[]>(() => {
    return bubbleEntries.value.map(buildApprovalView)
  })

  return {
    controller,
    isActive,
    isLastMessage,
    entries,
    pendingApprovalIds,
    bubbleViews,
    buildApprovalStep,
    buildApprovalView,
  }
}
