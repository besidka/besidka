<template>
  <ChatMessage role="assistant" data-testid="research-pending">
    <div class="flex flex-col gap-3 text-sm">
      <template v-if="!isTerminal">
        <div
          class="
            flex items-center gap-2 text-xs font-medium text-base-content/70
            py-1.5
          "
        >
          <SvgoGeminiShort
            v-if="job.provider === 'google'"
            class="size-3.5 fill-base-content/70"
          />
          <SvgoOpenai
            v-if="job.provider === 'openai'"
            class="size-3.5 fill-base-content/70"
          />
          <span data-testid="research-pending-status">
            {{ headerLabel }}
            <span
              v-if="showTimer && !checking"
              data-testid="research-pending-timer"
              class="text-base-content/60 tabular-nums"
            >
              ({{ elapsedLabel }})
            </span>
          </span>
        </div>
        <div
          v-if="!checking && timeEstimate"
          data-testid="research-pending-expectation"
          class="alert alert-info alert-soft text-xs"
        >
          <span>
            This can take {{ timeEstimate }} — you can leave; we'll
            notify you when it's ready.
          </span>
        </div>
        <progress
          v-if="!checking"
          data-testid="research-pending-progress"
          class="progress progress-accent w-full h-1 mt-1"
        />
        <ul
          v-if="!checking && recentSteps.length"
          data-testid="research-current-step"
          class="timeline timeline-compact timeline-snap-icon timeline-vertical"
        >
          <li
            v-for="(entry, index) in recentSteps"
            :key="`research-step-${index}-${entry.kind}`"
            data-testid="research-recent-step"
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
                <Icon
                  :name="iconForKind(entry.kind)"
                  class="!size-3 text-accent"
                />
              </span>
            </div>
            <div
              class="
                timeline-end my-2.5 mx-2 flex w-full min-w-0 flex-col
                gap-0.5 text-xs
              "
              :class="{
                'opacity-50': index !== recentSteps.length - 1,
                'hover:opacity-100 transition-opacity': entry.kind === 'read'
                  && index !== recentSteps.length - 1,
              }"
            >
              <button
                v-if="entry.kind === 'read'"
                type="button"
                data-testid="research-current-step-link"
                class="min-w-0 truncate text-left"
                @click="openResearchLink(entry.text)"
              >
                <span
                  class="min-w-0 truncate"
                  :class="{
                    'skeleton skeleton-text research-step-title-skeleton':
                      index === recentSteps.length - 1,
                  }"
                >
                  {{ stepTitle(entry) }}
                </span>
              </button>
              <span
                v-else
                class="min-w-0 truncate"
                :class="{
                  'skeleton skeleton-text research-step-title-skeleton':
                    index === recentSteps.length - 1,
                }"
              >
                {{ stepTitle(entry) }}
              </span>
            </div>
            <hr
              v-if="index < recentSteps.length - 1"
              class="bg-base-100"
            >
          </li>
        </ul>
      </template>
      <div
        v-if="job.status === 'cancelled'"
        data-testid="research-pending-cancelled"
        class="flex items-center gap-2 text-base-content/70"
      >
        <Icon name="lucide:circle-off" size="16" />
        <span>Research cancelled by user</span>
      </div>
      <div
        v-if="job.status === 'failed'"
        data-testid="research-pending-error"
        class="alert alert-error alert-soft flex flex-col items-start gap-0"
      >
        <p class="font-medium">
          {{ job.error?.message || 'Research failed' }}
        </p>
        <p v-if="job.error?.why" class="text-xs opacity-80">
          {{ job.error.why }}
        </p>
        <p v-if="job.error?.fix" class="text-xs opacity-80">
          {{ job.error.fix }}
        </p>
      </div>
      <div
        v-if="job.status === 'failed'
          || (!isTerminal && !checking && job.publicId !== 'local-pending')"
        class="flex items-center justify-end gap-2"
      >
        <button
          v-if="job.status === 'failed'"
          type="button"
          data-testid="research-dismiss"
          class="btn btn-ghost btn-sm"
          @click="emit('dismiss')"
        >
          Dismiss
        </button>
        <button
          v-if="job.status === 'failed'"
          type="button"
          data-testid="research-retry"
          class="btn btn-accent btn-sm"
          @click="emit('retry')"
        >
          Retry
        </button>
        <button
          v-if="!isTerminal && !checking && job.publicId !== 'local-pending'"
          type="button"
          data-testid="research-cancel"
          class="btn btn-ghost btn-sm"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </ChatMessage>
</template>

<script setup lang="ts">
import type {
  ResearchJobView,
  ResearchTraceEntry,
  ResearchTraceKind,
} from '#shared/types/research.d'

const KIND_ICONS: Record<ResearchTraceKind, string> = {
  thought: 'lucide:brain',
  search: 'lucide:search',
  read: 'lucide:link',
}

const props = withDefaults(defineProps<{
  job: ResearchJobView
  elapsedMs: number
  checking?: boolean
  recentSteps?: ResearchTraceEntry[]
}>(), {
  recentSteps: () => [],
})

const emit = defineEmits<{
  cancel: []
  retry: []
  dismiss: []
}>()

const { openResearchLink } = useResearchLink()

const isTerminal = computed<boolean>(() => {
  return props.job.status === 'failed' || props.job.status === 'cancelled'
})

const modelName = computed<string>(() => {
  return getModelName(props.job.modelId)
})

const tierLabel = computed<string>(() => {
  return props.job.level === 'thorough' ? 'Thorough' : 'Quick'
})

const headerLabel = computed<string>(() => {
  if (props.checking) {
    return 'Checking research status…'
  }

  if (props.job.status === 'pending') {
    return 'Preparing your research…'
  }

  return `Researching with ${modelName.value} · ${tierLabel.value}`
})

const elapsedLabel = computed<string>(() => {
  return formatResearchElapsed(props.elapsedMs)
})

const showTimer = computed<boolean>(() => {
  return props.job.startedAt !== null && props.elapsedMs > 0
})

const timeEstimate = computed<string>(() => {
  return getModel(props.job.modelId).model?.research?.timeEstimate ?? ''
})

function iconForKind(kind: ResearchTraceKind): string {
  return KIND_ICONS[kind]
}

function stepTitle(entry: ResearchTraceEntry): string {
  if (entry.kind === 'read') {
    return formatResearchLinkLabel(entry.text)
  }

  return parseResearchStepText(entry.text).title
}
</script>

<style scoped>
.research-step-title-skeleton {
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

:global([data-theme="dark"]) .research-step-title-skeleton {
  background-image: linear-gradient(
    105deg,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 0% 40%,
    color-mix(in oklab, var(--color-base-content) 45%, transparent) 50%,
    color-mix(in oklab, var(--color-base-content) 95%, transparent) 60% 100%
  );
}
</style>
