<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="memory-backfill-modal"
      class="js-memory-backfill-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      @close="onModalClosed"
    >
      <div class="modal-box max-w-xl max-h-[85dvh] flex flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
          >
            Build memory from past chats
          </h3>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close"
            data-testid="memory-backfill-close"
            @click="open = false"
          >
            <Icon name="lucide:x" size="16" />
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div
            v-if="view === 'loading'"
            class="grid gap-3"
            role="status"
            aria-label="Loading"
            data-testid="memory-backfill-loading"
          >
            <div class="skeleton skeleton--default h-5 w-2/3" />
            <div class="skeleton skeleton--default h-24 w-full rounded-box" />
            <div class="skeleton skeleton--default h-4 w-1/2" />
          </div>
          <div
            v-else-if="view === 'unavailable'"
            class="grid gap-3"
            data-testid="memory-backfill-unavailable"
          >
            <div
              role="alert"
              class="alert alert-soft alert-warning"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="shrink-0"
              />
              <p
                v-if="unavailableReason === 'no-model'"
                data-testid="memory-backfill-unavailable-message"
              >
                No model with an API key is available for memory. Add a key in
                <NuxtLink
                  to="/profile/keys"
                  class="link inline-block whitespace-nowrap font-semibold"
                  data-testid="memory-backfill-keys-link"
                >
                  Profile &gt; API Keys
                </NuxtLink>
                or pick a model under Models for memory.
              </p>
              <p
                v-else
                data-testid="memory-backfill-unavailable-message"
              >
                {{ unavailableMessage }}
              </p>
            </div>
            <div
              v-if="unavailableReason === 'all-chats-read'"
              class="flex justify-start"
            >
              <UiButton
                mode="neutral"
                outline
                size="sm"
                normal-case
                text="Read all past chats again"
                icon-name="lucide:rotate-ccw"
                :icon-size="16"
                data-testid="memory-backfill-restart"
                @click="offerRestart"
              />
            </div>
            <div
              v-if="isRetryableReason"
              class="flex justify-start"
            >
              <UiButton
                mode="neutral"
                outline
                size="sm"
                normal-case
                text="Try again"
                icon-name="lucide:refresh-cw"
                :icon-size="16"
                data-testid="memory-backfill-retry"
                @click="reload"
              />
            </div>
          </div>
          <div
            v-else-if="view === 'confirm'"
            class="grid gap-4"
            data-testid="memory-backfill-confirm"
          >
            <p
              v-if="isEmpty"
              class="rounded-box bg-base-content/5 p-4 text-sm"
              data-testid="memory-backfill-empty"
            >
              {{ isContinuation
                ? 'There are no older chats to read.'
                : 'There are no chats to read.' }}
            </p>
            <dl
              v-else-if="estimate"
              class="grid gap-3 rounded-box bg-base-content/5 p-4 text-sm"
            >
              <div class="grid gap-0.5">
                <dt class="text-base-content/70">Chats to read</dt>
                <dd
                  class="font-bold"
                  data-testid="memory-backfill-estimate-chats"
                >
                  {{ chatsText }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-base-content/70">Tokens</dt>
                <dd
                  class="font-bold"
                  data-testid="memory-backfill-estimate-tokens"
                >
                  {{ tokensText }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-base-content/70">Cost</dt>
                <dd
                  class="font-bold"
                  data-testid="memory-backfill-estimate-cost"
                >
                  {{ costText }}
                </dd>
              </div>
              <div
                v-if="modelText"
                class="grid gap-0.5"
              >
                <dt class="text-base-content/70">Model</dt>
                <dd
                  class="font-bold break-words"
                  data-testid="memory-backfill-estimate-model"
                >
                  {{ modelText }}
                </dd>
              </div>
            </dl>
            <div
              v-if="isRestart"
              role="alert"
              class="alert alert-soft alert-warning"
              data-testid="memory-backfill-restart-note"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="shrink-0"
              />
              <span>{{ restartNote }}</span>
            </div>
            <p
              class="text-xs text-base-content/70"
              data-testid="memory-backfill-estimate-note"
            >
              Numbers are approximate. Models with tiered or "from" prices
              may cost more than shown.
            </p>
            <p
              class="text-sm"
              data-testid="memory-backfill-scope-note"
            >
              Runs on your own API key. Reads your account chats (not
              projects) and may take several minutes.
            </p>
            <p
              class="text-xs text-base-content/70"
              data-testid="memory-backfill-limits-note"
            >
              {{ limitsText }}
            </p>
            <p
              v-if="lastRunText"
              class="text-xs text-base-content/70"
              data-testid="memory-backfill-last-run"
            >
              {{ lastRunText }}
            </p>
          </div>
          <div
            v-else-if="view === 'running' && job"
            class="grid gap-4"
            data-testid="memory-backfill-running"
          >
            <div class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <span class="font-bold">Reading chats</span>
                <span
                  aria-live="polite"
                  data-testid="memory-backfill-progress-text"
                >
                  {{ job.processedChats }} / {{ job.totalChats }} chats
                </span>
              </div>
              <progress
                class="progress progress-primary w-full"
                role="progressbar"
                aria-label="Chats processed"
                aria-valuemin="0"
                :aria-valuemax="job.totalChats"
                :aria-valuenow="job.processedChats"
                :value="job.processedChats"
                :max="Math.max(job.totalChats, 1)"
                data-testid="memory-backfill-progress"
              />
            </div>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Entries created</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-created"
                >
                  {{ job.createdEntries }}
                </dd>
              </div>
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Entries updated</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-updated"
                >
                  {{ job.updatedEntries }}
                </dd>
              </div>
            </dl>
            <p
              class="text-xs text-base-content/70"
              data-testid="memory-backfill-background-note"
            >
              You can close this sheet. It keeps going in the background where
              scheduled jobs run, and while this sheet is open on previews.
            </p>
          </div>
          <div
            v-else-if="view === 'summary' && job"
            class="grid gap-4"
            data-testid="memory-backfill-summary"
          >
            <p
              class="font-bold"
              data-testid="memory-backfill-summary-title"
            >
              {{ summaryTitle }}
            </p>
            <div
              v-if="failureText"
              role="alert"
              class="alert alert-soft alert-warning"
              data-testid="memory-backfill-failure"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="shrink-0"
              />
              <span>{{ failureText }}</span>
            </div>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Entries created</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-created"
                >
                  {{ job.createdEntries }}
                </dd>
              </div>
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Entries updated</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-updated"
                >
                  {{ job.updatedEntries }}
                </dd>
              </div>
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Chats skipped</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-skipped"
                >
                  {{ job.skippedChats }}
                </dd>
              </div>
              <div class="grid gap-0.5 rounded-box bg-base-content/5 p-3">
                <dt class="text-base-content/70">Chats failed</dt>
                <dd
                  class="text-lg font-bold"
                  data-testid="memory-backfill-failed"
                >
                  {{ job.failedChats }}
                </dd>
              </div>
            </dl>
            <p
              class="text-sm"
              data-testid="memory-backfill-summary-progress"
            >
              Read {{ job.processedChats }} of {{ job.totalChats }} chats.
            </p>
            <div
              v-if="droppedItems.length"
              class="grid gap-2"
              data-testid="memory-backfill-dropped"
            >
              <p class="text-sm font-bold">Not saved</p>
              <ul class="grid gap-1 text-sm">
                <li
                  v-for="item in droppedItems"
                  :key="item.reason"
                  class="flex items-baseline justify-between gap-3"
                  :data-testid="`memory-backfill-dropped-${item.reason}`"
                >
                  <span>{{ item.label }}</span>
                  <span class="font-bold">{{ item.count }}</span>
                </li>
              </ul>
            </div>
            <p
              class="text-xs text-base-content/70"
              data-testid="memory-backfill-tokens-used"
            >
              Used about {{ formatTokens(job.inputTokens) }} input and
              {{ formatTokens(job.outputTokens) }} output tokens.
            </p>
          </div>
          <p
            v-if="view === 'running' && error"
            role="alert"
            class="mt-3 text-sm text-error"
            data-testid="memory-backfill-error"
          >
            {{ errorText }}
          </p>
          <div
            v-if="view === 'running' && isPaused"
            class="mt-3 flex flex-wrap items-center justify-between gap-2"
            data-testid="memory-backfill-paused"
          >
            <p
              role="status"
              class="text-sm"
              data-testid="memory-backfill-paused-message"
            >
              Progress paused after repeated errors. Try again.
            </p>
            <UiButton
              mode="neutral"
              outline
              size="sm"
              normal-case
              text="Try again"
              icon-name="lucide:refresh-cw"
              :icon-size="16"
              data-testid="memory-backfill-resume"
              @click="resumeBuilding"
            />
          </div>
        </div>
        <div class="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2">
          <template v-if="view === 'running'">
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              normal-case
              text="Close"
              data-testid="memory-backfill-dismiss"
              @click="open = false"
            />
            <UiButton
              mode="error"
              outline
              size="sm"
              normal-case
              text="Stop"
              :disabled="isCancelling"
              data-testid="memory-backfill-cancel"
              @click="stopBuilding"
            />
          </template>
          <template v-else-if="view === 'summary'">
            <UiButton
              size="sm"
              normal-case
              text="Done"
              data-testid="memory-backfill-done"
              @click="open = false"
            />
          </template>
          <template v-else>
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              normal-case
              text="Cancel"
              data-testid="memory-backfill-dismiss"
              @click="open = false"
            />
            <UiButton
              size="sm"
              normal-case
              :text="isRestart ? 'Read again' : 'Build memory'"
              :disabled="!isStartEnabled"
              data-testid="memory-backfill-start"
              @click="startBuilding"
            >
              <template #icon>
                <span
                  v-if="isStarting"
                  class="loading loading-spinner loading-xs"
                />
                <Icon
                  v-else
                  name="lucide:brain"
                  size="16"
                />
              </template>
            </UiButton>
          </template>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { MemoryBackfillUnavailableReason } from '#shared/types/memory-backfill.d'

type BackfillView = 'loading' | 'unavailable' | 'confirm' | 'running'
  | 'summary'

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  changed: []
}>()

const headingId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const {
  overview,
  job,
  estimate,
  reason,
  isRunning,
  isStarting,
  isCancelling,
  isPaused,
  error,
  load,
  start,
  cancel,
  startPolling,
  stopPolling,
} = useMemoryBackfill()

const hasLoaded = shallowRef<boolean>(false)
const hasSeenRunningJob = shallowRef<boolean>(false)
const isRestart = shallowRef<boolean>(false)

const restartNote = BACKFILL_RESTART_NOTE

let lastEmittedEntryCount = 0

const unavailableReason = computed<MemoryBackfillUnavailableReason | null>(
  () => {
    if (reason.value) {
      return reason.value
    }

    return overview.value ? null : 'estimate-failed'
  },
)

const isRetryableReason = computed<boolean>(() => {
  return unavailableReason.value === 'estimate-failed'
    || unavailableReason.value === 'estimate-cooldown'
})

const unavailableMessage = computed<string>(() => {
  const unavailable = unavailableReason.value

  if (!unavailable || unavailable === 'no-model') {
    return ''
  }

  return memoryBackfillUnavailableCopy[unavailable]
})

const view = computed<BackfillView>(() => {
  if (!hasLoaded.value) {
    return 'loading'
  }

  if (isRunning.value) {
    return 'running'
  }

  if (hasSeenRunningJob.value && isBackfillJobFinished(job.value)) {
    return 'summary'
  }

  if (unavailableReason.value) {
    return 'unavailable'
  }

  return 'confirm'
})

const isEmpty = computed<boolean>(() => {
  return !!estimate.value && estimate.value.chats === 0
})

const isStartEnabled = computed<boolean>(() => {
  return !!estimate.value
    && !isEmpty.value
    && !unavailableReason.value
    && !isStarting.value
})

const isContinuation = computed<boolean>(() => {
  return estimate.value?.continuesPreviousRun === true
})

const chatsText = computed<string>(() => {
  return describeBackfillChats(
    estimate.value?.chats ?? 0,
    isContinuation.value,
  )
})

const limitsText = computed<string>(() => {
  return describeBackfillLimits(isContinuation.value)
})

const tokensText = computed<string>(() => {
  if (!estimate.value) {
    return ''
  }

  return `about ${formatTokens(estimate.value.inputTokens)} input tokens `
    + `and ${formatTokens(estimate.value.outputTokens)} output tokens`
})

const costText = computed<string>(() => {
  const costUsd = estimate.value?.costUsd ?? null

  if (costUsd === null) {
    return 'Price unknown for this model, so the cost can\'t be estimated.'
  }

  if (costUsd === 0) {
    return `About ${formatBackfillCost(costUsd)}`
  }

  return `Approximately ${formatBackfillCost(costUsd)}`
})

const modelText = computed<string>(() => {
  const model = estimate.value?.model

  if (!model) {
    return ''
  }

  return `${model.modelName} (${memoryBackfillModelSourceLabels[model.source]})`
})

const lastRunText = computed<string>(() => {
  const finishedJob = job.value

  if (!finishedJob || !isBackfillJobFinished(finishedJob)) {
    return ''
  }

  const age = formatMemoryUpdatedAge(
    new Date(finishedJob.finishedAt ?? finishedJob.startedAt),
  )
  const entries = finishedJob.createdEntries

  return `Last run: ${finishedJob.status} ${age}, `
    + `${entries} ${entries === 1 ? 'entry' : 'entries'} created.`
})

const errorText = computed<string>(() => {
  if (!error.value) {
    return ''
  }

  return [error.value.message, error.value.why].filter(Boolean).join(' ')
})

const summaryTitle = computed<string>(() => {
  const titles = {
    completed: 'Memory built from your past chats.',
    cancelled: 'Stopped. Entries added so far are kept.',
    failed: 'Stopped early. Entries added so far are kept.',
    running: '',
  }

  return titles[job.value?.status ?? 'running']
})

const failureText = computed<string>(() => {
  const failureReason = job.value?.failureReason

  if (!failureReason) {
    return ''
  }

  return memoryBackfillFailureLabels[failureReason]
})

const droppedItems = computed<{
  reason: string
  label: string
  count: number
}[]>(() => {
  return Object.entries(job.value?.dropped ?? {})
    .filter(([, count]) => count > 0)
    .map(([droppedReason, count]) => {
      return {
        reason: droppedReason,
        label: describeBackfillDroppedReason(droppedReason),
        count,
      }
    })
    .sort((first, second) => second.count - first.count)
})

function formatTokens(count: number): string {
  return getTokensNumber(count)
}

function emitChangedIfNeeded() {
  if (!hasSeenRunningJob.value) {
    return
  }

  const entryCount = countBackfillEntries(job.value)

  if (entryCount === 0 || entryCount === lastEmittedEntryCount) {
    return
  }

  lastEmittedEntryCount = entryCount
  emit('changed')
}

function syncPolling() {
  if (open.value && hasLoaded.value && isRunning.value) {
    hasSeenRunningJob.value = true
    startPolling()

    return
  }

  stopPolling()
}

async function reload() {
  hasLoaded.value = false

  await load({ restart: isRestart.value })

  hasLoaded.value = true

  syncPolling()
}

async function offerRestart() {
  isRestart.value = true

  await reload()
}

async function openSession() {
  hasSeenRunningJob.value = false
  isRestart.value = false
  lastEmittedEntryCount = 0

  await reload()
}

function closeSession() {
  stopPolling()
  emitChangedIfNeeded()
}

function onModalClosed() {
  if (modal.value?.open) {
    return
  }

  open.value = false
}

function showError() {
  if (!error.value) {
    return
  }

  useErrorMessage(error.value.message, error.value.why)
}

async function startBuilding() {
  const isStarted = await start({ restart: isRestart.value })

  if (!isStarted) {
    showError()
  }
}

function resumeBuilding() {
  startPolling()
}

async function stopBuilding() {
  const confirmation = await useConfirm({
    text: 'Stop building memory?',
    subtitle: 'Entries already added are kept. You can start again later.',
    actions: ['Stop'],
    labelDecline: 'Keep going',
  })

  if (!confirmation) {
    return
  }

  const isStopped = await cancel()

  if (!isStopped) {
    showError()
  }
}

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    modal.value.showModal()
    openSession()

    return
  }

  closeSession()
  modal.value.close()
}, { immediate: true, flush: 'post' })

watch(isRunning, syncPolling)

watch(() => job.value?.status, (status, previousStatus) => {
  if (previousStatus === 'running' && status && status !== 'running') {
    emitChangedIfNeeded()
  }
})
</script>
