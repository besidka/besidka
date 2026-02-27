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
        class="collapse-title flex items-center gap-1 p-0"
        @click.prevent="toggleMain"
      >
        <component
            :is="reasoningIcon"
            class="size-4 text-base-content/80"
          />
        <span
          class="font-medium text-xs"
          :class="[
            isReasoningStreaming
              ? 'skeleton skeleton-text reasoning-main-title-skeleton'
              : 'text-base-content/90',
          ]"
        >
          <template v-if="isReasoningStreaming && activeStreamingTitle.length">
            <span class="max-sm:hidden">Reasoning:</span>
            {{ activeStreamingTitle }}
          </template>
          <template v-else>
            {{ mainTitle }}
          </template>
          <span
            v-if="reasoningLabel.length > 0"
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
        <ul
          class="
            timeline timeline-compact timeline-snap-icon timeline-vertical
          "
        >
          <li
            v-for="(step, index) in reasoningSteps"
            :key="step.id"
          >
            <hr
              v-if="index > 0"
              class="bg-base-100"
            >
            <div class="timeline-middle">
              <span
                class="
                  flex size-5 items-center justify-center rounded-full
                  border border-base-100 bg-base-100
                "
              >
                <SvgoLoader
                  v-if="isStreamingStep(step.id)"
                  class="size-3.5 text-accent"
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
              class="group/point timeline-end collapse my-2.5 mx-2 w-full"
            >
              <summary
                :aria-controls="`reasoning-${message.id}-${step.id}-content`"
                class="collapse-title p-0 text-xs"
                @click.prevent="toggleStep(step.id)"
              >
                <span
                  class="align-middle"
                  :class="[
                    isStreamingStep(step.id)
                      ? 'skeleton skeleton-text reasoning-main-title-skeleton'
                      : undefined,
                  ]"
                >
                  {{ step.title }}
                </span>
                <Icon
                  name="lucide:chevron-right"
                  class="
                    ml-1 inline-block size-4 align-middle
                    transition-transform group-open/point:rotate-90
                  "
                />
              </summary>
              <div
                v-if="step.body.length > 0"
                :id="`reasoning-${message.id}-${step.id}-content`"
                class="collapse-content mt-2 pb-0 px-0"
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
            <hr
              v-if="index < reasoningSteps.length - 1"
              class="bg-base-100"
            >
          </li>
        </ul>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, ReasoningUIPart, ChatStatus } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import {
  extractLastCompleteReasoningTitle,
  parseReasoningSections,
} from '../../utils/reasoning'

const props = defineProps<{
  message: UIMessage
  status: ChatStatus
  reasoningLevel: ReasoningLevel
}>()

interface ReasoningStep {
  id: string
  title: string
  body: string
}

const reasoningIcon = computed<string>(() => {
  return `SvgoThink${props.reasoningLevel.charAt(0).toUpperCase() + props.reasoningLevel.slice(1)}`
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

const reasoningSteps = computed<ReasoningStep[]>(() => {
  const steps: ReasoningStep[] = []

  for (const [partIndex, part] of reasoningParts.value.entries()) {
    const sections = parseReasoningSections(part.text)

    for (const [sectionIndex, section] of sections.entries()) {
      steps.push({
        id: `${partIndex}-${sectionIndex}`,
        title: section.title,
        body: section.body,
      })
    }
  }

  return steps
})

const isReasoningStreaming = computed<boolean>(() => {
  if (props.status !== 'streaming') {
    return false
  }

  if (hasTextPart.value) {
    return false
  }

  return reasoningParts.value.length > 0
})

const activeStreamingStepId = computed<string>(() => {
  if (!isReasoningStreaming.value) {
    return ''
  }

  return reasoningSteps.value.at(-1)?.id || ''
})

const streamingTitle = shallowRef<string>('')
const streamingTitleUpdateTimer = ref<ReturnType<typeof setTimeout> | null>(
  null,
)
const latestStreamingTitleCandidate = computed<string>(() => {
  const latestReasoningText = reasoningParts.value.at(-1)?.text || ''

  return extractLastCompleteReasoningTitle(latestReasoningText)
})

const mainTitle = computed<string>(() => {
  if (!isReasoningStreaming.value) {
    return 'Reasoning process'
  }

  if (streamingTitle.value.length > 0) {
    return streamingTitle.value
  }

  return 'Reasoning'
})

const activeStreamingTitle = computed<string>(() => {
  if (!isReasoningStreaming.value) {
    return ''
  }

  return streamingTitle.value
})

const reasoningSeconds = shallowRef<number>(0)
const reasoningDurationSeconds = shallowRef<number>(0)
const { reasoningExpanded: isReasoningExpanded } = useUserSetting()

const isMainExpanded = shallowRef<boolean>(false)
const expandedStepId = shallowRef<string>('')
const isStreamingExpandOverride = shallowRef<boolean>(false)
const reasoningInterval = ref<ReturnType<typeof setInterval> | null>(null)

const reasoningLabel = computed<string>(() => {
  if (isReasoningStreaming.value && reasoningSeconds.value > 0) {
    return `${reasoningSeconds.value}s`
  }

  if (!isReasoningStreaming.value && reasoningDurationSeconds.value > 0) {
    return `${reasoningDurationSeconds.value}s`
  }

  return ''
})

watch(
  [
    isReasoningStreaming,
    () => reasoningSteps.value.at(-1)?.id,
    isReasoningExpanded,
    isStreamingExpandOverride,
  ],
  ([streaming, latestStepId, expandedSetting, overrideExpanded]) => {
    if (!streaming || !latestStepId) {
      return
    }

    if (!expandedSetting && !overrideExpanded) {
      return
    }

    isMainExpanded.value = true
    expandedStepId.value = latestStepId
  },
  {
    flush: 'post',
  },
)

watch(hasTextPart, (textStarted, hadText) => {
  if (!textStarted || hadText) {
    return
  }

  isMainExpanded.value = false
  expandedStepId.value = ''
  isStreamingExpandOverride.value = false
}, {
  flush: 'post',
})

watch(isReasoningStreaming, (streaming, wasStreaming) => {
  if (streaming) {
    startReasoningTimer()

    return
  }

  if (wasStreaming) {
    expandedStepId.value = ''
    isStreamingExpandOverride.value = false
  }

  stopReasoningTimer()
})

watch(
  [isReasoningStreaming, latestStreamingTitleCandidate],
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
    () => reasoningSteps.value.length,
    isReasoningStreaming,
    hasTextPart,
  ],
  ([mainExpanded, stepsLength, streaming, textStarted]) => {
    if (!mainExpanded || stepsLength !== 1) {
      return
    }

    // Avoid opening too early while more reasoning steps may still arrive.
    if (streaming && !textStarted) {
      return
    }

    const onlyStepId = reasoningSteps.value[0]?.id

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

  if (!isReasoningStreaming.value) {
    return
  }

  if (!willExpand) {
    isStreamingExpandOverride.value = false
    expandedStepId.value = ''

    return
  }

  isStreamingExpandOverride.value = true

  const latestStepId = reasoningSteps.value.at(-1)?.id

  if (!latestStepId) {
    return
  }

  expandedStepId.value = latestStepId
}

function toggleStep(stepId: string) {
  if (expandedStepId.value === stepId) {
    expandedStepId.value = ''

    return
  }

  expandedStepId.value = stepId
}

function isStreamingStep(stepId: string): boolean {
  if (!activeStreamingStepId.value) {
    return false
  }

  return activeStreamingStepId.value === stepId
}

function startReasoningTimer() {
  if (reasoningInterval.value) {
    return
  }

  reasoningDurationSeconds.value = 0
  reasoningSeconds.value = 1
  reasoningInterval.value = setInterval(() => {
    reasoningSeconds.value += 1
  }, 1000)
}

function stopReasoningTimer() {
  reasoningDurationSeconds.value = reasoningSeconds.value

  if (reasoningInterval.value) {
    clearInterval(reasoningInterval.value)
    reasoningInterval.value = null
  }

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
</style>
