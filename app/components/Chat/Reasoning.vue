<template>
  <div
    v-if="hiddenReasoningTokens > 0 && reasoningSteps.length === 0"
    data-testid="hidden-reasoning-indicator"
    class="my-1 text-sm"
    :title="HIDDEN_REASONING_TITLE"
  >
    <div class="flex items-center gap-1 py-1.5">
      <SvgoThinkMedium class="size-4 text-base-content/80" />
      <span class="font-medium text-xs text-base-content/90">
        Reasoned · {{ formatTokenCount(hiddenReasoningTokens) }} tokens
      </span>
      <span class="sr-only">{{ HIDDEN_REASONING_TITLE }}</span>
    </div>
  </div>
  <div
    v-if="reasoningSteps.length > 0"
    class="my-1 text-sm"
  >
    <details
      :open="isMainExpanded"
      class="group collapse"
    >
      <summary
        :id="`reasoning-${message.id}-label`"
        :aria-controls="isMainExpanded
          ? `reasoning-${message.id}-content`
          : undefined
        "
        class="collapse-title flex items-center gap-1 px-0 py-1.5 min-h-0"
        data-testid="reasoning-header"
        @click.prevent="toggleMain"
      >
        <span
          aria-hidden="true"
          :data-kind="headerStepIcon ? headerStepIcon.kind : 'thinking'"
          data-testid="reasoning-header-icon"
          class="inline-flex size-4 shrink-0 items-center justify-center"
        >
          <ChatReasoningStepIcon
            v-if="headerStepIcon"
            :icon="headerStepIcon"
            class="size-4!"
          />
          <component
            :is="reasoningIcon"
            v-else
            class="size-4 text-base-content/80"
          />
        </span>
        <span
          :title="isHiddenReasoningSummary ? HIDDEN_REASONING_TITLE : undefined"
          :data-testid="
            isHiddenReasoningSummary ? 'hidden-reasoning-summary' : undefined
          "
          class="flex min-w-0 items-baseline gap-1 font-medium text-xs"
          :class="[
            isThinkingStreaming
              ? 'skeleton skeleton-text reasoning-main-title-skeleton'
              : 'text-base-content/90',
          ]"
        >
          <template v-if="isThinkingStreaming && activeStreamingTitle.length">
            <span
              v-if="hasReasoningKindStep"
              class="shrink-0 max-sm:hidden"
            >Reasoning:</span>
            <span
              :title="activeStreamingTitle"
              class="min-w-0 truncate"
            >
              {{ truncateReasoningTitle(activeStreamingTitle) }}
            </span>
          </template>
          <template v-else>
            {{ mainTitle }}
          </template>
          <span
            v-if="reasoningLabel.length > 0"
            data-testid="reasoning-timer-label"
            class="shrink-0"
          >
            ({{ reasoningLabel }})
          </span>
          <span
            v-if="isHiddenReasoningSummary"
            class="sr-only"
          >
            {{ HIDDEN_REASONING_TITLE }}
          </span>
        </span>
        <Icon
          name="lucide:chevron-right"
          class="size-4 shrink-0 text-base-content/60 transition-transform group-open:rotate-90"
        />
        <span
          v-if="headerImages.length > 0 && !isMainExpanded"
          class="-my-1 ml-auto flex h-6 shrink-0 items-center gap-1 pl-2"
          data-testid="reasoning-header-images"
        >
          <ChatReasoningConnectorThumbnail
            :image="headerImages[0]!.image"
            :alt="headerImages[0]!.alt"
            size="sm"
            :gallery="headerImages"
            :stack-label="headerStackLabel"
          />
        </span>
      </summary>
      <div
        v-if="isMainExpanded"
        :id="`reasoning-${message.id}-content`"
        class="collapse-content mt-3 pb-2 px-0"
      >
        <div
          ref="stepsScroller"
          class="max-h-[360px] overflow-y-auto overscroll-contain pr-1"
          data-testid="reasoning-steps-scroller"
          @scroll.passive="onStepsScroll"
        >
          <ul
            ref="stepsList"
            data-testid="reasoning-steps"
            class="flex flex-col"
          >
            <ChatReasoningStep
              v-for="(step, index) in reasoningSteps"
              :key="step.id"
              :step="step"
              :message-id="message.id"
              :is-first="index === 0"
              :is-last="index === reasoningSteps.length - 1"
              :is-expanded="expandedStepId === step.id"
              :body-cache-key="`reasoning-${message.id}-${step.id}-${status}`"
              :can-manage-grants="!!approvalController"
              :searched-at="searchedAt"
              @toggle="toggleStep"
              @manage-grants="openGrantsPanel"
            />
          </ul>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, ReasoningUIPart, ChatStatus } from 'ai'
import { LazyChatContextPanel } from '#components'
import { CHAT_CONTEXT_VIEW_KEY } from '~/composables/chat-context'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ReasoningStep } from '~/types/reasoning-step.d'
import { getConnectorToolCall } from '#shared/utils/connectors-parts'
import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'
import { getConnectorImagesByToolCallId } from '#shared/utils/connector-image-parts'
import { isAwaitingApprovalToolPart } from '#shared/utils/tool-approval-parts'
import { CONNECTOR_TOOL_NAME_PREFIX } from '#shared/utils/connectors-policy'
import { SKILL_ACTIVATE_TOOL_NAME } from '#shared/utils/skills/runtime'
import { getGrantMarkersByToolCallId } from '~/utils/tool-approval-step'
import {
  getConnectorImageAlt,
  getConnectorImageStackLabel,
  getConnectorStepTitle,
  isConnectorStepFailed,
} from '~/utils/connector-step'
import { formatTokenCount } from '#shared/utils/message-format'
import {
  getToolPartDocumentFormat,
  resolveReasoningStepSource,
} from '~/utils/reasoning-step-icons'
import type {
  ReasoningStepIcon,
  ReasoningStepSource,
  ReasoningStepSourceInput,
} from '~/utils/reasoning-step-icons'
import {
  createReasoningSectionsCache,
  reuseStableReasoningSteps,
} from '~/utils/reasoning-steps'
import { formatPastChatPreRetrievalTitle } from '#shared/utils/past-chat-retrieval'

const HIDDEN_REASONING_TITLE = 'This model reasoned before answering, but '
  + 'the reasoning text is not available for this response. Reasoning '
  + 'tokens are billed as output tokens.'

const STEPS_PIN_THRESHOLD_PX = 24

const props = defineProps<{
  message: UIMessage
  status: ChatStatus
  reasoningLevel: ReasoningLevel
  turnStartedAt: number
  reasoningAccumulatedMs: number
  reasoningSegmentStartedAt: number
  isTurnThinkingHeld: boolean
  isShared?: boolean
}>()

const { titlesBySlug, connectorsBySlug } = useConnectorTitles()
const sidePanel = useSidePanel()
const {
  controller: approvalController,
  entries: approvalEntries,
  buildApprovalStep,
  buildApprovalView,
} = useMessageApprovals(() => props.message, {
  isShared: () => props.isShared,
})

function openGrantsPanel() {
  sidePanel.open({
    viewKey: CHAT_CONTEXT_VIEW_KEY,
    title: 'Chat',
    mode: 'context',
    component: LazyChatContextPanel,
  })
}

interface HeaderConnectorImage {
  image: ConnectorImagePartData
  alt: string
  title: string
}

const reasoningIcon = computed<string>(() => {
  const level = props.reasoningLevel

  if (
    level === 'off'
    && (hasReasoningKindStep.value || hiddenReasoningTokens.value > 0)
  ) {
    return 'SvgoThinkMedium'
  }

  const capitalized = level.charAt(0).toUpperCase() + level.slice(1)

  return `SvgoThink${capitalized}`
})

const searchedAt = computed<string | number | Date | undefined>(() => {
  return getMessageMetadata(props.message).createdAt
})

const searchProvider = computed<string | undefined>(() => {
  return getMessageMetadata(props.message).usage?.searchProvider
})

function resolveStepSource(
  input: Omit<
    ReasoningStepSourceInput,
    'searchProvider' | 'allowConnectorIcon'
  >,
): ReasoningStepSource {
  return resolveReasoningStepSource({
    ...input,
    searchProvider: searchProvider.value,
    allowConnectorIcon: !props.isShared,
  })
}

const reasoningParts = computed<ReasoningUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'reasoning' && part.text?.length
  }) as ReasoningUIPart[]
})

const hasTextPart = computed<boolean>(() => {
  return props.message.parts.some((part) => {
    return part.type === 'text'
  })
})

const isReasoningTextStreaming = computed<boolean>(() => {
  if (props.status !== 'streaming') {
    return false
  }

  return hasStreamingReasoningPart(props.message.parts)
})

const isThinkingStreaming = computed<boolean>(() => {
  return props.status === 'streaming' && props.isTurnThinkingHeld
})

const isAssistantMessage = computed<boolean>(() => {
  return props.message.role === 'assistant'
})

const reasoningSectionsCache = createReasoningSectionsCache()

/**
 * One step per reasoning section and per tool call, rebuilt on every
 * streamed update. The connector images and grant markers are read once per
 * update, and steps whose values did not change keep their previous object
 * (see `reuseStableReasoningSteps`), so only the changed steps re-render.
 */
const reasoningSteps = computed<ReasoningStep[]>((previousSteps) => {
  const steps: ReasoningStep[] = []
  const { parts } = props.message
  const imagesByToolCallId = isAssistantMessage.value && !props.isShared
    ? getConnectorImagesByToolCallId(parts)
    : new Map<string, ConnectorImagePartData[]>()
  const grantMarkersByToolCallId = getGrantMarkersByToolCallId(parts)
  let reasoningPartIndex = 0
  let lastReasoningStepIndex = -1

  for (const [partIndex, part] of parts.entries()) {
    if (part.type === 'reasoning') {
      if (!part.text?.length) {
        continue
      }

      for (const [sectionIndex, section] of reasoningSectionsCache.parse(
        part.text,
      ).entries()) {
        lastReasoningStepIndex = steps.length
        steps.push({
          id: `${reasoningPartIndex}-${sectionIndex}`,
          title: section.title,
          body: section.body,
          kind: 'reasoning',
          pending: false,
          failed: false,
          search: null,
          memory: null,
          skill: null,
          connector: null,
        })
      }

      reasoningPartIndex += 1

      continue
    }

    const skillStep = isAssistantMessage.value
      ? getReasoningSkillStep(parts, partIndex)
      : null

    if (skillStep) {
      const skillSource = resolveStepSource({
        toolName: SKILL_ACTIVATE_TOOL_NAME,
        title: getSkillStepTitle(skillStep),
      })

      steps.push({
        id: `skill-${partIndex}`,
        title: skillSource.label,
        icon: skillSource.icon,
        body: '',
        kind: 'tool',
        pending: props.status === 'streaming' && skillStep.state === 'working',
        failed: skillStep.state === 'failed',
        search: null,
        memory: null,
        skill: skillStep,
        connector: null,
      })

      continue
    }

    const approvalEntry = approvalEntries.value.get(partIndex)

    if (approvalEntry && approvalEntry.state !== 'approved') {
      const approvalView = buildApprovalView(approvalEntry)

      steps.push({
        id: approvalView.id,
        title: approvalView.title,
        icon: approvalView.icon,
        body: '',
        kind: 'tool',
        pending: approvalEntry.state === 'sending',
        failed: approvalEntry.state === 'expired'
          || approvalEntry.state === 'interrupted',
        waiting: approvalEntry.state === 'pending'
          || approvalEntry.state === 'answered',
        search: null,
        memory: null,
        skill: null,
        connector: null,
        approval: approvalView.approval,
      })

      continue
    }

    const approvalOutcome = approvalEntry
      ? buildApprovalStep(approvalEntry).outcome
      : ''
    const toolCallId = (part as { toolCallId?: string }).toolCallId

    const connectorCall = isAssistantMessage.value
      ? getConnectorToolCall(part)
      : null

    if (connectorCall) {
      const connectorTitle = titlesBySlug.value.get(connectorCall.slug)
        || connectorCall.slug
      const connectorSource = resolveStepSource({
        toolName: `${CONNECTOR_TOOL_NAME_PREFIX}${connectorCall.slug}`
          + `__${connectorCall.tool}`,
        title: getConnectorStepTitle(
          connectorCall,
          titlesBySlug.value.get(connectorCall.slug),
        ),
        connectorId: connectorsBySlug.value.get(connectorCall.slug)?.id,
        connectorTitle,
      })

      steps.push({
        id: `tool-${toolCallId || partIndex}`,
        title: connectorSource.label,
        icon: connectorSource.icon,
        body: '',
        kind: 'tool',
        pending: props.status === 'streaming' && connectorCall.isRunning,
        failed: isConnectorStepFailed(connectorCall),
        search: null,
        memory: null,
        skill: null,
        connector: connectorCall,
        connectorTitle,
        connectorImages: toolCallId
          ? imagesByToolCallId.get(toolCallId) ?? []
          : [],
        approvalOutcome,
        grantMarker: toolCallId
          ? grantMarkersByToolCallId.get(toolCallId) ?? ''
          : '',
      })

      continue
    }

    if (
      !isThinkingToolPart(part)
      || isSupersededInvalidDocumentPart(parts, partIndex)
    ) {
      continue
    }

    const isPending = props.status === 'streaming' && isPendingToolPart(part)
    const isFailed = isFailedToolPart(part)
    const searchData = getSearchStepData(part)
    const isPreRetrievedStep = searchData?.preRetrieval === true
      && !isPending
      && !isFailed
    const toolStepTitle = isAwaitingApprovalToolPart(part)
      ? `Waiting for approval: ${getToolPartName(part)}`
      : getToolStepTitle(getToolPartName(part), isPending, isFailed)

    const toolSource = resolveStepSource({
      toolName: getToolPartName(part),
      title: searchData && isPreRetrievedStep
        ? formatPastChatPreRetrievalTitle(searchData.results.length)
        : toolStepTitle,
      isPending,
      isFailed,
      isAwaitingApproval: isAwaitingApprovalToolPart(part),
      documentFormat: getToolPartDocumentFormat(part),
    })

    steps.push({
      id: `tool-${toolCallId || partIndex}`,
      title: toolSource.label,
      icon: toolSource.icon,
      body: '',
      kind: 'tool',
      pending: isPending,
      failed: isFailed,
      search: searchData,
      memory: getMemoryStepData(part),
      skill: null,
      connector: null,
      approvalOutcome,
      grantMarker: toolCallId
        ? grantMarkersByToolCallId.get(toolCallId) ?? ''
        : '',
    })
  }

  reasoningSectionsCache.commit()

  if (lastReasoningStepIndex >= 0 && isReasoningTextStreaming.value) {
    const lastReasoningStep = steps[lastReasoningStepIndex]

    if (lastReasoningStep) {
      lastReasoningStep.pending = true
    }
  }

  return reuseStableReasoningSteps(previousSteps ?? [], steps)
})

const expandableSteps = computed<ReasoningStep[]>(() => {
  return reasoningSteps.value.filter((step) => {
    return step.body.length > 0
  })
})

const latestExpandableStepId = computed<string>(() => {
  return expandableSteps.value.at(-1)?.id || ''
})

const hasReasoningKindStep = computed<boolean>(() => {
  return reasoningSteps.value.some((step) => {
    return step.kind === 'reasoning'
  })
})

const hiddenReasoningTokens = computed<number>(() => {
  if (props.message.role !== 'assistant' || hasReasoningKindStep.value) {
    return 0
  }

  return getMessageMetadata(props.message).usage?.reasoningTokens ?? 0
})

const streamingTitle = shallowRef<string>('')
const streamingTitleIcon = shallowRef<ReasoningStepIcon | null>(null)
const streamingTitleUpdateTimer = shallowRef<
  ReturnType<typeof setTimeout> | null
>(null)
const latestPendingToolStep = computed<ReasoningStep | null>(() => {
  const pendingToolStep = reasoningSteps.value
    .filter((step) => {
      return step.kind === 'tool' && step.pending
    })
    .at(-1)

  if (pendingToolStep && !isReasoningTextStreaming.value) {
    return pendingToolStep
  }

  return null
})
const latestStreamingTitleCandidate = computed<string>(() => {
  if (latestPendingToolStep.value) {
    return latestPendingToolStep.value.title
  }

  return extractLastCompleteReasoningTitle(
    reasoningParts.value.at(-1)?.text || '',
  )
})
const latestStreamingIconCandidate = computed<ReasoningStepIcon | null>(() => {
  return latestPendingToolStep.value?.icon ?? null
})

const isHiddenReasoningSummary = computed<boolean>(() => {
  return !isThinkingStreaming.value && hiddenReasoningTokens.value > 0
})

const mainTitle = computed<string>(() => {
  if (hasReasoningKindStep.value) {
    return isThinkingStreaming.value ? 'Reasoning' : 'Reasoning process'
  }

  if (isHiddenReasoningSummary.value) {
    return `Reasoned · ${formatTokenCount(hiddenReasoningTokens.value)} tokens`
  }

  return isThinkingStreaming.value ? 'Working' : 'Steps'
})

const activeStreamingTitle = computed<string>(() => {
  if (!isThinkingStreaming.value) {
    return ''
  }

  return streamingTitle.value
})

const headerImages = computed<HeaderConnectorImage[]>(() => {
  return reasoningSteps.value.flatMap((step) => {
    const title = step.connectorTitle ?? ''
    const alt = getConnectorImageAlt(title)

    return (step.connectorImages ?? [])
      .filter(image => !image.deleted)
      .map(image => ({ image, alt, title }))
  })
})

const headerStackLabel = computed<string>(() => {
  const count = headerImages.value.length
  const titles = new Set(headerImages.value.map(entry => entry.title))

  return getConnectorImageStackLabel(
    count,
    titles.size === 1 ? [...titles][0] : undefined,
  )
})

const headerStepIcon = computed<ReasoningStepIcon | null>(() => {
  if (!isThinkingStreaming.value || !activeStreamingTitle.value.length) {
    return null
  }

  return streamingTitleIcon.value
})

const reasoningSeconds = shallowRef<number>(0)
const reasoningDurationSeconds = shallowRef<number>(0)
const {
  stepsExpanded: isStepsExpanded,
  stepsAutoHide,
} = useUserSetting()

const isMainExpanded = shallowRef<boolean>(false)
const expandedStepId = shallowRef<string>('')
const isStreamingExpandOverride = shallowRef<boolean>(false)
const hasAutoHiddenThisMessage = shallowRef<boolean>(false)
const isMainCollapsedByUser = shallowRef<boolean>(false)
const reasoningInterval = shallowRef<
  ReturnType<typeof setInterval> | null
>(null)

const stepsScroller = useTemplateRef<HTMLDivElement>('stepsScroller')
const stepsList = useTemplateRef<HTMLUListElement>('stepsList')
const isStepsPinnedToBottom = shallowRef<boolean>(true)
let lastStepsScrollTop = 0

const isStepsAutoScrollActive = computed<boolean>(() => {
  return props.status === 'streaming' && isMainExpanded.value
})

function onStepsScroll() {
  const scroller = stepsScroller.value

  if (!scroller) {
    return
  }

  const isScrolledUp = scroller.scrollTop < lastStepsScrollTop

  lastStepsScrollTop = scroller.scrollTop

  if (isScrolledUp) {
    isStepsPinnedToBottom.value = false

    return
  }

  isStepsPinnedToBottom.value = scroller.scrollHeight
    - scroller.scrollTop
    - scroller.clientHeight <= STEPS_PIN_THRESHOLD_PX
}

function scrollStepsToBottom() {
  const scroller = stepsScroller.value

  if (!scroller) {
    return
  }

  scroller.scrollTop = scroller.scrollHeight
  lastStepsScrollTop = scroller.scrollTop
}

useResizeObserver(stepsList, () => {
  if (!isStepsAutoScrollActive.value || !isStepsPinnedToBottom.value) {
    return
  }

  scrollStepsToBottom()
})

watch(isStepsAutoScrollActive, async (isActive) => {
  if (!isActive) {
    return
  }

  isStepsPinnedToBottom.value = true
  lastStepsScrollTop = 0
  await nextTick()
  scrollStepsToBottom()
}, {
  immediate: true,
  flush: 'post',
})

const reasoningLabel = computed<string>(() => {
  if (isThinkingStreaming.value && reasoningSeconds.value > 0) {
    return `${reasoningSeconds.value}s`
  }

  if (!isThinkingStreaming.value && reasoningDurationSeconds.value > 0) {
    return `${reasoningDurationSeconds.value}s`
  }

  return ''
})

// The gate (streaming + "some step exists") still checks the latest step
// regardless of body, since the very first streamed chunk of a real
// reasoning turn is always bodyless (no title/sentence boundary yet) and
// must still auto-open the box. Only the step targeted for expansion is
// restricted to latestExpandableStepId, so a bodyless tool step can never
// steal expansion away from a reasoning step that actually has content.
watch(
  [
    isThinkingStreaming,
    () => reasoningSteps.value.at(-1)?.id,
    latestExpandableStepId,
    isStepsExpanded,
    isStreamingExpandOverride,
  ],
  ([
    streaming,
    latestStepId,
    latestExpandableId,
    expandedSetting,
    overrideExpanded,
  ]) => {
    if (!streaming || !latestStepId) {
      return
    }

    if (hasAutoHiddenThisMessage.value || isMainCollapsedByUser.value) {
      return
    }

    if (!expandedSetting && !overrideExpanded) {
      return
    }

    isMainExpanded.value = true
    expandedStepId.value = latestExpandableId
  },
  {
    flush: 'post',
  },
)

watch(hasTextPart, (textStarted, hadText) => {
  if (!textStarted || hadText) {
    return
  }

  if (!stepsAutoHide.value) {
    return
  }

  isMainExpanded.value = false
  expandedStepId.value = ''
  isStreamingExpandOverride.value = false
  hasAutoHiddenThisMessage.value = true
}, {
  flush: 'post',
})

// immediate: true — a recovery-poll remount (see turnStartedAt prop above)
// can create this component directly in an already-streaming state, with
// no false->true edge for a non-immediate watcher to ever observe.
watch(isThinkingStreaming, (streaming, wasStreaming) => {
  if (streaming) {
    startReasoningTimer()

    return
  }

  if (wasStreaming) {
    // Only expandedStepId is wiped here, not isStreamingExpandOverride — on
    // OpenAI's Responses API this transition can fire once per reasoning
    // summary part (a real done->streaming boundary between two summary
    // parts of the same reasoning block), because a tool-calling gap no
    // longer ends a thinking segment at all under isThinkingStreaming.
    expandedStepId.value = ''
  } else if (
    wasStreaming === undefined
    && props.status === 'streaming'
    && props.reasoningAccumulatedMs > 0
  ) {
    // A recovery-poll remount landing after this turn's reasoning AND any
    // tool calls have already finished (e.g. reasoning is done, the tool
    // call it triggered is also done, and answer text is now streaming)
    // would otherwise show no duration label at all for the rest of the
    // message, since stopReasoningTimer() below is a no-op when no local
    // interval was ever started.
    reasoningDurationSeconds.value = computeElapsedReasoningSeconds()
  }

  stopReasoningTimer()
}, {
  immediate: true,
})

watch(
  [
    isThinkingStreaming,
    latestStreamingTitleCandidate,
    latestStreamingIconCandidate,
  ],
  ([streaming, candidateTitle, candidateIcon]) => {
    if (!streaming) {
      streamingTitle.value = ''
      streamingTitleIcon.value = null
      clearStreamingTitleTimer()

      return
    }

    if (
      !candidateTitle
      || (
        candidateTitle === streamingTitle.value
        && isSameStepIcon(candidateIcon, streamingTitleIcon.value)
      )
    ) {
      return
    }

    clearStreamingTitleTimer()
    streamingTitleUpdateTimer.value = setTimeout(() => {
      streamingTitle.value = candidateTitle
      streamingTitleIcon.value = candidateIcon
      streamingTitleUpdateTimer.value = null
    }, 250)
  },
)

watch(
  [
    isMainExpanded,
    () => expandableSteps.value.length,
    isThinkingStreaming,
  ],
  ([mainExpanded, expandableStepsLength, streaming]) => {
    if (!mainExpanded || expandableStepsLength !== 1) {
      return
    }

    if (streaming) {
      return
    }

    const onlyStepId = expandableSteps.value[0]?.id

    if (!onlyStepId || expandedStepId.value === onlyStepId) {
      return
    }

    expandedStepId.value = onlyStepId
  },
  {
    flush: 'post',
  },
)

function isSameStepIcon(
  first: ReasoningStepIcon | null,
  second: ReasoningStepIcon | null,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function clearStreamingTitleTimer() {
  if (!streamingTitleUpdateTimer.value) {
    return
  }

  clearTimeout(streamingTitleUpdateTimer.value)
  streamingTitleUpdateTimer.value = null
}

function toggleMain() {
  const willExpand = !isMainExpanded.value

  isMainExpanded.value = willExpand
  isMainCollapsedByUser.value = !willExpand

  if (!willExpand) {
    isStreamingExpandOverride.value = false
  }

  if (!isThinkingStreaming.value) {
    return
  }

  if (!willExpand) {
    expandedStepId.value = ''

    return
  }

  isStreamingExpandOverride.value = true

  const latestStepId = latestExpandableStepId.value

  if (!latestStepId) {
    return
  }

  expandedStepId.value = latestStepId
}

function toggleStep(step: ReasoningStep) {
  if (!step.body.length) {
    return
  }

  if (expandedStepId.value === step.id) {
    expandedStepId.value = ''

    return
  }

  isStepsPinnedToBottom.value = false
  expandedStepId.value = step.id
}

// Elapsed time is computed from props owned by useChat() (see its comments
// there) rather than a timestamp captured locally by this component — the
// recovery-poll loop destroys and remounts this exact component every few
// seconds while a turn is being resent, so any locally captured "started at"
// value would reset on every poll. Deriving from the stable props means a
// freshly remounted instance immediately computes the correct elapsed time
// regardless of how many times it has been torn down and rebuilt.
//
// The result is the sum of every completed thinking segment this turn
// (reasoningAccumulatedMs) plus however long the current live segment has
// been running (now - reasoningSegmentStartedAt) — genuine "time spent
// thinking", not wall-clock-since-turn-start. The total now covers both
// streaming reasoning and in-flight non-image tool calls (both count as
// "thinking"), while still excluding answer-text streaming and idle time.
// turnStartedAt is kept only as the "is this prop wiring live at all" gate
// (0 on the shared/read-only page).
function computeElapsedReasoningSeconds(): number {
  if (!props.turnStartedAt) {
    return 0
  }

  const liveSegmentElapsedMs = props.reasoningSegmentStartedAt
    ? Date.now() - props.reasoningSegmentStartedAt
    : 0

  return Math.max(
    1,
    Math.round(
      (props.reasoningAccumulatedMs + liveSegmentElapsedMs) / 1000,
    ),
  )
}

function startReasoningTimer() {
  reasoningDurationSeconds.value = 0
  reasoningSeconds.value = computeElapsedReasoningSeconds()

  if (reasoningInterval.value) {
    return
  }

  reasoningInterval.value = setInterval(() => {
    reasoningSeconds.value = computeElapsedReasoningSeconds()
  }, 1000)
}

function stopReasoningTimer() {
  if (!reasoningInterval.value) {
    return
  }

  reasoningDurationSeconds.value = computeElapsedReasoningSeconds()
  clearInterval(reasoningInterval.value)
  reasoningInterval.value = null
  reasoningSeconds.value = 0
}

onBeforeUnmount(() => {
  if (!reasoningInterval.value) {
    clearStreamingTitleTimer()

    return
  }

  clearInterval(reasoningInterval.value)
  reasoningInterval.value = null
  clearStreamingTitleTimer()
})
</script>

<style>
.skeleton.reasoning-main-title-skeleton {
  background-color: transparent !important;
  border-radius: 0 !important;
  display: inline-block;
  background-image: linear-gradient(
    105deg,
    color-mix(in oklab, var(--color-base-content) 55%, transparent) 0% 40%,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 50%,
    color-mix(in oklab, var(--color-base-content) 55%, transparent) 60% 100%
  );
}

.skeleton.reasoning-main-title-skeleton.flex {
  display: flex;
}

[data-theme="dark"] .skeleton.reasoning-main-title-skeleton {
  background-image: linear-gradient(
    105deg,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 0% 40%,
    color-mix(in oklab, var(--color-base-content) 45%, transparent) 50%,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 60% 100%
  );
}
</style>
