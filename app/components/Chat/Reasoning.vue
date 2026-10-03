<template>
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
        :aria-controls="`reasoning-${message.id}-content`"
        class="collapse-title flex items-center gap-1 px-0 py-1.5 min-h-0"
        @click.prevent="toggleMain"
      >
        <component
            :is="reasoningIcon"
            class="size-4 text-base-content/80"
          />
        <span
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
        </span>
        <Icon
          name="lucide:chevron-right"
          class="size-4 text-base-content/60 transition-transform group-open:rotate-90"
        />
      </summary>
      <div
        :id="`reasoning-${message.id}-content`"
        class="collapse-content mt-3 pb-2 px-0"
      >
        <div class="max-h-[360px] overflow-y-auto overscroll-contain pr-1">
          <ul
            data-testid="reasoning-steps"
            class="flex flex-col"
          >
            <li
              v-for="(step, index) in reasoningSteps"
              :key="step.id"
              class="relative flex min-w-0 gap-2"
            >
              <div
                class="relative flex w-5 shrink-0 items-start justify-center"
              >
                <span
                  v-if="index > 0"
                  aria-hidden="true"
                  data-testid="reasoning-step-connector-top"
                  class="
                    absolute top-0 left-1/2 h-2 w-1 -translate-x-1/2 bg-base-100
                  "
                />
                <span
                  v-if="index < reasoningSteps.length - 1"
                  aria-hidden="true"
                  data-testid="reasoning-step-connector-bottom"
                  class="
                    absolute top-7 bottom-0 left-1/2 w-1 -translate-x-1/2
                    bg-base-100
                  "
                />
                <span
                  class="
                    relative z-10 mt-2 flex size-5 items-center justify-center
                    rounded-full border border-base-100 bg-base-100
                  "
                >
                  <SvgoLoader
                    v-if="step.pending"
                    class="size-3.5 text-accent"
                  />
                  <span
                    v-else-if="step.failed"
                    aria-hidden="true"
                    class="reasoning-step-failed"
                  />
                  <span
                    v-else
                    aria-hidden="true"
                    class="reasoning-step-complete"
                  />
                </span>
              </div>
              <details
                :open="expandedStepId === step.id"
                class="group/point collapse my-2.5 min-w-0 flex-1"
              >
                <summary
                  :aria-controls="`reasoning-${message.id}-${step.id}-content`"
                  class="collapse-title flex min-w-0 items-center p-0 text-xs"
                  @click.prevent="toggleStep(step)"
                >
                  <span
                    :title="step.title"
                    data-testid="reasoning-step-title"
                    class="min-w-0"
                    :class="[
                      step.body.length > 0
                        ? 'truncate'
                        : 'break-words',
                      step.pending
                        ? 'skeleton skeleton-text reasoning-main-title-skeleton'
                        : undefined,
                    ]"
                  >
                    {{
                      step.body.length > 0
                        ? truncateReasoningTitle(step.title)
                        : step.title
                    }}
                  </span>
                  <Icon
                    v-if="step.body.length > 0"
                    name="lucide:chevron-right"
                    class="
                      ml-1 size-4 shrink-0 transition-transform
                      group-open/point:rotate-90
                    "
                  />
                </summary>
                <div
                  v-if="step.body.length > 0"
                  :id="`reasoning-${message.id}-${step.id}-content`"
                  class="collapse-content mt-2 min-w-0 pb-0 px-0"
                >
                  <MDCCached
                    :key="`reasoning-${message.id}-${step.id}-${status}`"
                    :cache-key="`reasoning-${message.id}-${step.id}-${status}`"
                    :value="step.body"
                    :parser-options="{ highlight: false }"
                    class="chat-markdown text-xs !text-text/80"
                  />
                </div>
              </details>
            </li>
          </ul>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, ReasoningUIPart, ChatStatus } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

const props = defineProps<{
  message: UIMessage
  status: ChatStatus
  reasoningLevel: ReasoningLevel
  turnStartedAt: number
  reasoningAccumulatedMs: number
  reasoningSegmentStartedAt: number
  isTurnThinkingHeld: boolean
}>()

interface ReasoningStep {
  id: string
  title: string
  body: string
  kind: 'reasoning' | 'tool'
  pending: boolean
  failed: boolean
}

const reasoningIcon = computed<string>(() => {
  const level = props.reasoningLevel
  const capitalized = level.charAt(0).toUpperCase() + level.slice(1)

  return `SvgoThink${capitalized}`
})

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

const reasoningSteps = computed<ReasoningStep[]>(() => {
  const steps: ReasoningStep[] = []
  let reasoningPartIndex = 0
  let lastReasoningStepIndex = -1

  for (const [partIndex, part] of props.message.parts.entries()) {
    if (part.type === 'reasoning') {
      if (!part.text?.length) {
        continue
      }

      for (const [sectionIndex, section] of parseReasoningSections(
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
        })
      }

      reasoningPartIndex += 1

      continue
    }

    if (!isThinkingToolPart(part)) {
      continue
    }

    const isPending = props.status === 'streaming' && isPendingToolPart(part)
    const isFailed = isFailedToolPart(part)
    const toolCallId = (part as { toolCallId?: string }).toolCallId

    steps.push({
      id: `tool-${toolCallId || partIndex}`,
      title: getToolStepTitle(getToolPartName(part), isPending, isFailed),
      body: '',
      kind: 'tool',
      pending: isPending,
      failed: isFailed,
    })
  }

  if (lastReasoningStepIndex >= 0 && isReasoningTextStreaming.value) {
    const lastReasoningStep = steps[lastReasoningStepIndex]

    if (lastReasoningStep) {
      lastReasoningStep.pending = true
    }
  }

  return steps
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

const streamingTitle = shallowRef<string>('')
const streamingTitleUpdateTimer = shallowRef<
  ReturnType<typeof setTimeout> | null
>(null)
const latestStreamingTitleCandidate = computed<string>(() => {
  const pendingToolStep = reasoningSteps.value
    .filter((step) => {
      return step.kind === 'tool' && step.pending
    })
    .at(-1)

  if (pendingToolStep && !isReasoningTextStreaming.value) {
    return pendingToolStep.title
  }

  return extractLastCompleteReasoningTitle(
    reasoningParts.value.at(-1)?.text || '',
  )
})

const mainTitle = computed<string>(() => {
  if (hasReasoningKindStep.value) {
    return isThinkingStreaming.value ? 'Reasoning' : 'Reasoning process'
  }

  return isThinkingStreaming.value ? 'Working' : 'Steps'
})

const activeStreamingTitle = computed<string>(() => {
  if (!isThinkingStreaming.value) {
    return ''
  }

  return streamingTitle.value
})

const reasoningSeconds = shallowRef<number>(0)
const reasoningDurationSeconds = shallowRef<number>(0)
const {
  reasoningExpanded: isReasoningExpanded,
  reasoningAutoHide,
} = useUserSetting()

const isMainExpanded = shallowRef<boolean>(false)
const expandedStepId = shallowRef<string>('')
const isStreamingExpandOverride = shallowRef<boolean>(false)
const hasAutoHiddenThisMessage = shallowRef<boolean>(false)
const reasoningInterval = shallowRef<
  ReturnType<typeof setInterval> | null
>(null)

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
    isReasoningExpanded,
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

    if (hasAutoHiddenThisMessage.value) {
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

  if (!reasoningAutoHide.value) {
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
  [isThinkingStreaming, latestStreamingTitleCandidate],
  ([streaming, candidateTitle]) => {
    if (!streaming) {
      streamingTitle.value = ''
      clearStreamingTitleTimer()

      return
    }

    if (!candidateTitle || candidateTitle === streamingTitle.value) {
      return
    }

    clearStreamingTitleTimer()
    streamingTitleUpdateTimer.value = setTimeout(() => {
      streamingTitle.value = candidateTitle
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

  if (!isThinkingStreaming.value) {
    return
  }

  if (!willExpand) {
    isStreamingExpandOverride.value = false
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

<style scoped>
.reasoning-main-title-skeleton {
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

.reasoning-main-title-skeleton.flex {
  display: flex;
}

:global([data-theme="dark"]) .reasoning-main-title-skeleton {
  background-image: linear-gradient(
    105deg,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 0% 40%,
    color-mix(in oklab, var(--color-base-content) 45%, transparent) 50%,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 60% 100%
  );
}

.reasoning-step-complete {
  display: inline-flex;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 9999px;
  background-color: color-mix(
    in oklab,
    var(--color-accent) 20%,
    transparent
  );
}

.reasoning-step-failed {
  display: inline-flex;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 9999px;
  background-color: color-mix(
    in oklab,
    var(--color-error) 20%,
    transparent
  );
}
</style>
