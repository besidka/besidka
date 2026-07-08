<template>
  <div
    v-if="hasResearchContent"
    class="my-1 text-sm"
  >
    <details
      :open="isMainExpanded"
      class="group collapse"
    >
      <summary
        :id="`research-${message.id}-label`"
        :aria-controls="`research-${message.id}-content`"
        class="collapse-title flex flex-wrap items-center gap-1 p-0"
        @click.prevent="toggleMain"
      >
        <Icon
          name="lucide:telescope"
          class="size-4 text-base-content/80"
        />
        <span class="font-medium text-xs text-base-content/90">
          Deep research
          <span
            v-if="researchLabel.length > 0"
            data-testid="research-timer-label"
          >
            ({{ researchLabel }})
          </span>
        </span>
        <span
          v-if="researchBrief"
          class="badge badge-soft badge-xs capitalize"
        >
          {{ researchBrief.depth }}
        </span>
        <span
          v-if="isResearchActive"
          class="text-xs text-base-content/50"
        >
          researching…
        </span>
        <span
          v-if="countersLabel.length > 0"
          class="text-xs text-base-content/60"
        >
          {{ countersLabel }}
        </span>
        <Icon
          name="lucide:chevron-right"
          class="
            size-4 text-base-content/60 transition-transform
            group-open:rotate-90
          "
        />
      </summary>
      <div
        :id="`research-${message.id}-content`"
        class="collapse-content mt-3 pb-2 px-0"
      >
        <div
          v-if="researchBrief"
          class="
            flex flex-wrap items-center gap-2 mb-2 text-xs text-base-content/70
          "
        >
          <Icon name="lucide:target" class="size-3" />
          <span class="truncate">{{ researchBrief.topic }}</span>
        </div>
        <p
          v-if="isResearchActive"
          class="mb-3 text-xs text-base-content/50"
        >
          Deep research usually takes a few minutes.
        </p>
        <ul
          v-if="researchMilestones.length > 0"
          class="
            timeline timeline-compact timeline-snap-icon timeline-vertical
          "
        >
          <li
            v-for="(milestone, index) in researchMilestones"
            :key="milestone.phase"
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
                  v-if="milestone.status === 'active'"
                  class="size-3.5 text-accent"
                />
                <span
                  v-else
                  aria-hidden="true"
                  class="research-step-complete"
                />
              </span>
            </div>
            <div
              v-if="!milestone.detail"
              class="timeline-end my-2.5 mx-2 w-full text-xs"
            >
              <Icon
                :name="getPhaseIcon(milestone.phase)"
                class="mr-1 inline-block size-3.5 align-middle"
              />
              <span
                class="align-middle"
                :class="[
                  milestone.status === 'active'
                    ? 'skeleton skeleton-text research-main-title-skeleton'
                    : undefined,
                ]"
              >
                {{ milestone.label }}
              </span>
              <span
                v-if="milestone.count"
                class="ml-1 badge badge-soft badge-xs"
              >
                {{ milestone.count }}
              </span>
            </div>
            <details
              v-else
              :open="expandedPhase === milestone.phase"
              class="group/point timeline-end collapse my-2.5 mx-2 w-full"
            >
              <summary
                :aria-controls="getMilestoneContentId(milestone.phase)"
                class="collapse-title p-0 text-xs"
                @click.prevent="togglePhase(milestone.phase)"
              >
                <Icon
                  :name="getPhaseIcon(milestone.phase)"
                  class="mr-1 inline-block size-3.5 align-middle"
                />
                <span
                  class="align-middle"
                  :class="[
                    milestone.status === 'active'
                      ? 'skeleton skeleton-text research-main-title-skeleton'
                      : undefined,
                  ]"
                >
                  {{ milestone.label }}
                </span>
                <span
                  v-if="milestone.count"
                  class="ml-1 badge badge-soft badge-xs"
                >
                  {{ milestone.count }}
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
                :id="getMilestoneContentId(milestone.phase)"
                class="collapse-content mt-2 pb-0 px-0"
              >
                <p class="text-xs !text-text/80 break-words">
                  {{ milestone.detail }}
                </p>
              </div>
            </details>
            <hr
              v-if="index < researchMilestones.length - 1"
              class="bg-base-100"
            >
          </li>
        </ul>
        <details
          v-if="hasReasoningContent"
          class="group/thinking collapse mt-3"
        >
          <summary
            :id="`research-${message.id}-thinking-label`"
            :aria-controls="`research-${message.id}-thinking-content`"
            class="collapse-title flex items-center gap-1 p-0 text-xs"
          >
            <Icon
              name="lucide:lightbulb"
              class="size-3.5 text-base-content/70"
            />
            <span class="text-base-content/80">Thinking</span>
            <Icon
              name="lucide:chevron-right"
              class="
                size-4 text-base-content/50 transition-transform
                group-open/thinking:rotate-90
              "
            />
          </summary>
          <div
            :id="`research-${message.id}-thinking-content`"
            class="collapse-content mt-2 pb-0 px-0"
          >
            <ChatReasoning
              :message="message"
              :status="status"
              :reasoning-level="reasoningLevel"
              :turn-started-at="turnStartedAt"
              embedded
            />
          </div>
        </details>
        <ChatUrlSources :message="message" />
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, ChatStatus } from 'ai'
import type {
  ResearchStepData,
  ResearchStepPhase,
  ResearchBriefData,
} from '#shared/types/research.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

const props = withDefaults(defineProps<{
  message: UIMessage
  status: ChatStatus
  turnStartedAt: number
  reasoningLevel?: ReasoningLevel
}>(), {
  reasoningLevel: 'off',
})

interface ResearchStepUIPart {
  type: 'data-research-step'
  id?: string
  data: ResearchStepData
}

interface ResearchBriefUIPart {
  type: 'data-research-brief'
  id?: string
  data: ResearchBriefData
}

const PHASE_ORDER: ResearchStepPhase[] = [
  'planning',
  'searching',
  'reading',
  'analyzing',
  'synthesizing',
]

const PHASE_ICONS: Record<ResearchStepPhase, string> = {
  planning: 'lucide:brain',
  searching: 'lucide:globe',
  reading: 'lucide:book',
  analyzing: 'lucide:search',
  synthesizing: 'lucide:sparkles',
}

const researchStepParts = computed<ResearchStepUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'data-research-step'
  }) as ResearchStepUIPart[]
})

const researchBriefParts = computed<ResearchBriefUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'data-research-brief'
  }) as ResearchBriefUIPart[]
})

const researchBrief = computed<ResearchBriefData | null>(() => {
  return researchBriefParts.value.at(-1)?.data ?? null
})

const researchMilestones = computed<ResearchStepData[]>(() => {
  const latestByPhase = new Map<ResearchStepPhase, ResearchStepData>()

  for (const part of researchStepParts.value) {
    latestByPhase.set(part.data.phase, part.data)
  }

  const milestones: ResearchStepData[] = []

  for (const phase of PHASE_ORDER) {
    const milestone = latestByPhase.get(phase)

    if (!milestone) {
      continue
    }

    milestones.push(milestone)
  }

  return milestones
})

const hasResearchContent = computed<boolean>(() => {
  return researchMilestones.value.length > 0 || Boolean(researchBrief.value)
})

const sourceUrlCount = computed<number>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'source-url'
  }).length
})

const countersLabel = computed<string>(() => {
  const segments: string[] = []

  if (sourceUrlCount.value > 0) {
    const noun = sourceUrlCount.value === 1 ? 'source' : 'sources'

    segments.push(`${sourceUrlCount.value} ${noun}`)
  }

  if (researchMilestones.value.length > 0) {
    const noun = researchMilestones.value.length === 1 ? 'step' : 'steps'

    segments.push(`${researchMilestones.value.length} ${noun}`)
  }

  return segments.join(' · ')
})

const hasReasoningContent = computed<boolean>(() => {
  return props.message.parts.some((part) => {
    return part.type === 'reasoning' && Boolean(part.text?.length)
  })
})

const activePhase = computed<ResearchStepPhase | ''>(() => {
  const activeMilestone = researchMilestones.value.find((milestone) => {
    return milestone.status === 'active'
  })

  return activeMilestone?.phase ?? ''
})

const hasFinalReportText = computed<boolean>(() => {
  return props.message.parts.some((part) => {
    return part.type === 'text' && Boolean(part.text?.length)
  })
})

const isResearchActive = computed<boolean>(() => {
  if (props.status !== 'streaming') {
    return false
  }

  if (hasFinalReportText.value) {
    return false
  }

  return hasResearchContent.value
})

const researchSeconds = shallowRef<number>(0)
const researchDurationSeconds = shallowRef<number>(0)
const isMainExpanded = shallowRef<boolean>(true)
const expandedPhase = shallowRef<ResearchStepPhase | ''>('')
const researchInterval = shallowRef<
  ReturnType<typeof setInterval> | null
>(null)

const researchLabel = computed<string>(() => {
  if (isResearchActive.value && researchSeconds.value > 0) {
    return `${researchSeconds.value}s`
  }

  if (!isResearchActive.value && researchDurationSeconds.value > 0) {
    return `${researchDurationSeconds.value}s`
  }

  return ''
})

watch(
  [isResearchActive, activePhase, isMainExpanded],
  ([active, phase, mainExpanded]) => {
    if (!active || !phase || !mainExpanded) {
      return
    }

    expandedPhase.value = phase
  },
  {
    flush: 'post',
  },
)

watch(hasFinalReportText, (hasFinalText, hadFinalText) => {
  if (!hasFinalText || hadFinalText) {
    return
  }

  isMainExpanded.value = false
  expandedPhase.value = ''
}, {
  flush: 'post',
})

// immediate: true — same recovery-poll remount hazard as ChatReasoning (see
// its own comment on this pattern): the recovery-poll loop resends the
// in-progress turn every few seconds, which destroys and remounts this
// component keyed by message.id. A non-immediate watcher would never see
// the false->true edge when it mounts directly into an already-active turn.
watch(isResearchActive, (active, wasActive) => {
  if (active) {
    startResearchTimer()

    return
  }

  if (wasActive) {
    expandedPhase.value = ''
  }

  stopResearchTimer()
}, {
  immediate: true,
})

function computeElapsedResearchSeconds(): number {
  if (!props.turnStartedAt) {
    return 0
  }

  return Math.max(
    1,
    Math.round((Date.now() - props.turnStartedAt) / 1000),
  )
}

function startResearchTimer() {
  researchDurationSeconds.value = 0
  researchSeconds.value = computeElapsedResearchSeconds()

  if (researchInterval.value) {
    return
  }

  researchInterval.value = setInterval(() => {
    researchSeconds.value = computeElapsedResearchSeconds()
  }, 1000)
}

function stopResearchTimer() {
  if (!researchInterval.value) {
    return
  }

  researchDurationSeconds.value = computeElapsedResearchSeconds()
  clearInterval(researchInterval.value)
  researchInterval.value = null
  researchSeconds.value = 0
}

function toggleMain() {
  const willExpand = !isMainExpanded.value

  isMainExpanded.value = willExpand

  if (!willExpand) {
    expandedPhase.value = ''

    return
  }

  if (activePhase.value) {
    expandedPhase.value = activePhase.value
  }
}

function togglePhase(phase: ResearchStepPhase) {
  if (expandedPhase.value === phase) {
    expandedPhase.value = ''

    return
  }

  expandedPhase.value = phase
}

function getPhaseIcon(phase: ResearchStepPhase): string {
  return PHASE_ICONS[phase]
}

function getMilestoneContentId(phase: ResearchStepPhase): string {
  return `research-${props.message.id}-${phase}-content`
}

onBeforeUnmount(() => {
  if (!researchInterval.value) {
    return
  }

  clearInterval(researchInterval.value)
  researchInterval.value = null
})
</script>

<style scoped>
.research-main-title-skeleton {
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

:global([data-theme="dark"]) .research-main-title-skeleton {
  background-image: linear-gradient(
    105deg,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 0% 40%,
    color-mix(in oklab, var(--color-base-content) 45%, transparent) 50%,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 60% 100%
  );
}

.research-step-complete {
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
