<template>
  <ChatMessage role="assistant" data-testid="research-pending">
    <div class="flex flex-col gap-3 text-sm">
      <template v-if="!isTerminal">
        <div class="flex items-center gap-2">
          <SvgoLoader class="size-3.5" />
          <span
            data-testid="research-pending-status"
            class="font-medium text-base-content/90"
          >
            {{ statusLabel }}
          </span>
          <span
            data-testid="research-pending-timer"
            class="text-base-content/60 tabular-nums"
          >
            {{ elapsedLabel }}
          </span>
        </div>
        <div
          data-testid="research-pending-level"
          class="text-xs text-base-content/70"
        >
          {{ levelConfig?.label ?? job.level }} · {{ job.modelId }}
        </div>
        <p
          v-if="levelConfig?.timeEstimate"
          class="text-xs text-base-content/60"
        >
          This can take {{ levelConfig.timeEstimate }} — you can leave; we'll
          notify you when it's ready.
        </p>
      </template>
      <div
        v-if="job.status === 'cancelled'"
        data-testid="research-pending-cancelled"
        class="flex items-center gap-2 text-base-content/70"
      >
        <Icon name="lucide:circle-off" size="16" />
        <span>Research cancelled</span>
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
      <div class="flex items-center justify-end gap-2">
        <button
          v-if="isTerminal"
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
          v-if="!isTerminal"
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
  ResearchLevelConfig,
} from '#shared/types/research.d'

const props = defineProps<{
  job: ResearchJobView
  elapsedMs: number
}>()

const emit = defineEmits<{
  cancel: []
  retry: []
  dismiss: []
}>()

const isTerminal = computed<boolean>(() => {
  return props.job.status === 'failed' || props.job.status === 'cancelled'
})

const statusLabel = computed<string>(() => {
  return props.job.status === 'pending'
    ? 'Preparing your research…'
    : 'Researching…'
})

const elapsedLabel = computed<string>(() => {
  return formatResearchElapsed(props.elapsedMs)
})

const levelConfig = computed<ResearchLevelConfig | null>(() => {
  return getResearchProviderConfig(props.job.provider, props.job.level)
})
</script>
