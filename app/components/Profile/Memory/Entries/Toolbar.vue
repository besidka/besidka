<template>
  <div class="grid gap-2">
    <div
      class="flex flex-col items-start gap-3"
      data-testid="memory-toolbar-rows"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <p
          v-if="total !== null && limit !== null"
          class="shrink-0 text-sm text-base-content/70"
          data-testid="memory-entries-count"
        >
          {{ total }} of {{ limit }}
        </p>
      </div>
      <div
        class="flex w-full flex-wrap items-center justify-start gap-2"
        data-testid="memory-toolbar-actions"
      >
        <UiButton
          size="sm"
          normal-case
          icon-name="lucide:plus"
          text="Add memory"
          data-testid="memory-add"
          @click="emit('add')"
        />
        <div
          v-if="$slots['extra-actions']"
          class="flex flex-wrap items-center gap-2 js-memory-extra-actions"
          data-testid="memory-extra-actions"
        >
          <slot name="extra-actions" />
        </div>
        <button
          v-if="canUpdateNow"
          type="button"
          class="btn btn-sm btn-primary normal-case"
          :class="{ 'btn-disabled': isUpdating }"
          :disabled="isUpdating"
          data-testid="memory-update-now"
          @click="updateMemoryNow"
        >
          <Icon
            v-if="isUpdating"
            name="lucide:loader-circle"
            size="16"
            class="shrink-0 animate-spin"
            data-testid="memory-update-now-spinner"
          />
          <Icon
            v-else
            name="lucide:refresh-cw"
            size="16"
            class="shrink-0"
          />
          <span
            class="grid text-left"
            data-testid="memory-update-now-labels"
          >
            <span
              class="col-start-1 row-start-1"
              :class="{ invisible: isUpdating }"
              :aria-hidden="isUpdating"
              data-testid="memory-update-now-idle-label"
            >
              Update memory now
            </span>
            <span
              class="col-start-1 row-start-1"
              :class="{ invisible: !isUpdating }"
              :aria-hidden="!isUpdating"
              data-testid="memory-update-now-busy-label"
            >
              Updating...
            </span>
          </span>
        </button>
        <div class="hidden sm:contents">
          <button
            type="button"
            class="btn btn-sm normal-case btn-ghost btn-ghost-legacy"
            :class="{ 'opacity-60': isBackfillGated }"
            :title="backfillTitle"
            :aria-describedby="isBackfillGated ? backfillHintId : undefined"
            data-testid="memory-backfill"
            @click="openBackfill"
          >
            <Icon
              v-if="isBackfillRunning"
              name="lucide:loader-circle"
              size="16"
              class="shrink-0 animate-spin"
              data-testid="memory-backfill-spinner"
            />
            <Icon
              v-else
              name="lucide:history"
              size="16"
              class="shrink-0"
            />
            <span
              class="grid text-left"
              data-testid="memory-backfill-labels"
            >
              <span
                class="col-start-1 row-start-1"
                :class="{ invisible: isBackfillBusy }"
                :aria-hidden="isBackfillBusy"
                data-testid="memory-backfill-idle-label"
              >
                {{ BACKFILL_IDLE_LABEL }}
              </span>
              <span
                class="col-start-1 row-start-1 tabular-nums"
                :class="{ invisible: !isBackfillBusy }"
                :aria-hidden="!isBackfillBusy"
                data-testid="memory-backfill-busy-label"
              >
                {{ backfillProgressLabel }}
              </span>
            </span>
          </button>
          <button
            type="button"
            class="btn btn-sm normal-case btn-ghost btn-ghost-legacy"
            data-testid="memory-import"
            @click="openImport"
          >
            <Icon name="lucide:file-input" size="16" />
            Import memory
          </button>
          <a
            href="/api/v1/memory/export"
            download
            class="btn btn-ghost btn-ghost-legacy btn-sm"
            data-testid="memory-export"
          >
            <Icon name="lucide:download" size="16" />
            Export JSON
          </a>
          <UiButton
            mode="error"
            ghost
            size="sm"
            normal-case
            text="Reset memory…"
            :disabled="isResetDisabled"
            data-testid="memory-reset"
            @click="resetMemory"
          />
        </div>
        <details
          ref="moreMenu"
          class="dropdown dropdown-start w-full sm:hidden"
          data-testid="memory-more"
          @toggle="onMoreToggle"
          @keydown.esc="closeMoreMenu(true)"
        >
          <summary
            class="btn btn-ghost btn-ghost-legacy btn-sm normal-case"
            :aria-expanded="isMoreOpen"
            data-testid="memory-more-trigger"
          >
            <Icon name="lucide:ellipsis" size="16" />
            More
          </summary>
          <ul
            class="dropdown-content menu menu-sm z-50 mt-2 w-64 max-w-full rounded-box bg-base-100 p-1 shadow-lg"
            aria-label="More memory actions"
          >
            <li>
              <button
                type="button"
                :class="{ 'opacity-60': isBackfillGated }"
                :aria-describedby="
                  isBackfillGated ? backfillHintId : undefined
                "
                data-testid="memory-backfill-menu"
                @click="chooseMenuAction(openBackfill)"
              >
                <Icon
                  v-if="isBackfillRunning"
                  name="lucide:loader-circle"
                  size="16"
                  class="shrink-0 animate-spin"
                  data-testid="memory-backfill-menu-spinner"
                />
                <Icon
                  v-else
                  name="lucide:history"
                  size="16"
                  class="shrink-0"
                />
                <span class="tabular-nums">{{ backfillLabel }}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                data-testid="memory-import-menu"
                @click="chooseMenuAction(openImport)"
              >
                <Icon name="lucide:file-input" size="16" />
                Import memory
              </button>
            </li>
            <li>
              <a
                href="/api/v1/memory/export"
                download
                data-testid="memory-export-menu"
                @click="closeMoreMenu(true)"
              >
                <Icon name="lucide:download" size="16" />
                Export JSON
              </a>
            </li>
            <li :class="{ 'menu-disabled': isResetDisabled }">
              <button
                type="button"
                class="text-error"
                :disabled="isResetDisabled"
                data-testid="memory-reset-menu"
                @click="chooseMenuAction(resetMemory)"
              >
                <Icon name="lucide:trash-2" size="16" />
                Reset memory…
              </button>
            </li>
          </ul>
        </details>
      </div>
    </div>
    <p
      v-if="canUpdateNow"
      class="text-xs text-base-content/60"
      data-testid="memory-update-now-note"
    >
      {{ updateNowNote }}
    </p>
    <span
      v-if="isBackfillGated"
      :id="backfillHintId"
      class="sr-only"
    >
      {{ backfillGateHint }}
    </span>
    <LazyProfileMemoryEntriesBackfillSheet
      v-model:open="isBackfillOpen"
      @changed="emit('changed')"
    />
    <LazyProfileMemoryEntriesImportSheet
      v-model:open="isImportOpen"
      @changed="emit('changed')"
    />
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { MemorySettingsFields } from '#shared/types/memory.d'

const props = defineProps<{
  settings: MemorySettingsFields
  total: number | null
  limit: number | null
}>()

const emit = defineEmits<{
  changed: []
  add: []
}>()

const HISTORY_LOOKUP_LIMIT = 100

const BACKFILL_REFRESH_INTERVAL_MS = 20_000

const BACKFILL_IDLE_LABEL = 'Build memory from past chats'

const BACKFILL_BUSY_PLACEHOLDER = 'Building memory…'

const backfillHintId = useId()
const moreMenu = useTemplateRef<HTMLDetailsElement>('moreMenu')
const {
  job: backfillJob,
  isRunning: isBackfillRunning,
  load: loadBackfill,
} = useMemoryBackfill()

const isUpdating = shallowRef<boolean>(false)
const isResetting = shallowRef<boolean>(false)
const isBackfillOpen = shallowRef<boolean>(false)
const isImportOpen = shallowRef<boolean>(false)
const isMoreOpen = shallowRef<boolean>(false)

const canUpdateNow = computed<boolean>(() => {
  return props.settings.memoryEnabled
    && props.settings.memoryExtractionEnabled
})

const isResetDisabled = computed<boolean>(() => {
  return !props.total || isResetting.value
})

const isBackfillGated = computed<boolean>(() => {
  return !props.settings.memoryEnabled
    || !props.settings.memoryExtractionEnabled
})

const backfillGateHint = computed<string>(() => {
  return props.settings.memoryEnabled
    ? memoryBackfillUnavailableCopy['extraction-disabled']
    : memoryBackfillUnavailableCopy['memory-disabled']
})

const isBackfillBusy = computed<boolean>(() => {
  return isBackfillRunning.value && !!backfillJob.value
})

const backfillProgressLabel = computed<string>(() => {
  const job = backfillJob.value

  if (!job) {
    return BACKFILL_BUSY_PLACEHOLDER
  }

  return `${BACKFILL_BUSY_PLACEHOLDER} ${job.processedChats}/${job.totalChats}`
})

const backfillLabel = computed<string>(() => {
  return isBackfillBusy.value
    ? backfillProgressLabel.value
    : BACKFILL_IDLE_LABEL
})

const backfillTitle = computed<string | undefined>(() => {
  return isBackfillGated.value ? backfillGateHint.value : undefined
})

const isBackfillRefreshing = computed<boolean>(() => {
  return isBackfillRunning.value && !isBackfillOpen.value
})

const updateNowNote = 'Reads your latest account chat and runs on your own '
  + 'API key.'

const extractionNotices: Record<string, string> = {
  'leased': 'Besidka is already updating memory from this chat.',
  'no-user-text': 'No new messages to read since the last update.',
  'too-short': 'Your latest chat is too short to learn from yet.',
  'nothing-durable': 'Nothing new worth remembering in that chat.',
  'disabled': 'Memory generation is turned off.',
  'project-unavailable': 'This project is no longer available.',
  'chat-unavailable': 'Your latest chat is no longer available.',
}

function openBackfill() {
  isBackfillOpen.value = true
}

function openImport() {
  isImportOpen.value = true
}

function onMoreToggle() {
  isMoreOpen.value = !!moreMenu.value?.open
}

function closeMoreMenu(shouldRestoreFocus: boolean = false) {
  if (!moreMenu.value?.open) {
    return
  }

  moreMenu.value.open = false
  isMoreOpen.value = false

  if (shouldRestoreFocus) {
    moreMenu.value.querySelector('summary')?.focus()
  }
}

function chooseMenuAction(action: () => void | Promise<void>) {
  closeMoreMenu(true)
  action()
}

onClickOutside(moreMenu, () => {
  closeMoreMenu()
})

onMounted(() => {
  loadBackfill()
})

watch(isBackfillRefreshing, (isRefreshing, _previous, onCleanup) => {
  if (!isRefreshing) {
    return
  }

  const timer = setInterval(loadBackfill, BACKFILL_REFRESH_INTERVAL_MS)

  onCleanup(() => clearInterval(timer))
}, { immediate: true })

watch(() => backfillJob.value?.status, (status, previousStatus) => {
  if (
    previousStatus === 'running'
    && status
    && status !== 'running'
    && !isBackfillOpen.value
  ) {
    emit('changed')
  }
})

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function pickLatestChatSlug(
  chats: { slug: string, activityAt: Date | string | number }[],
): string | null {
  const [latestChat] = [...chats].sort((first, second) => {
    return new Date(second.activityAt).getTime()
      - new Date(first.activityAt).getTime()
  })

  return latestChat?.slug ?? null
}

async function findLatestChatSlug(): Promise<string | null> {
  const history = await $fetch('/api/v1/chats/history', {
    query: { limit: HISTORY_LOOKUP_LIMIT },
  })
  const accountChats = [...history.pinned, ...history.chats].filter((chat) => {
    return !chat.projectId
  })

  return pickLatestChatSlug(accountChats)
}

const { ensureSendConsent, handleConsentError } = useLegalConsent()

async function updateMemoryNow() {
  if (!await ensureSendConsent(null)) {
    return
  }

  isUpdating.value = true

  try {
    const chatSlug = await findLatestChatSlug()

    if (!chatSlug) {
      useInfoMessage(
        'No chats to read yet',
        'Start a chat outside any project, then try again.',
      )

      return
    }

    const result = await $fetch('/api/v1/memory/extract-now', {
      method: 'POST',
      body: { chatSlug },
    })

    announceExtraction(result)
    emit('changed')
  } catch (exception) {
    if (await handleConsentError(exception)) {
      return
    }

    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to update memory.',
      parsedException.why,
    )
  } finally {
    isUpdating.value = false
  }
}

function announceExtraction(result: {
  status: string
  reason?: string
  created: number
  updated: number
  deleted: number
}) {
  if (result.status === 'failed') {
    useErrorMessage(
      'Failed to update memory.',
      'Besidka could not read your latest chat. Try again in a minute.',
    )

    return
  }

  if (result.status !== 'extracted') {
    useInfoMessage(
      'Memory not updated',
      extractionNotices[result.status]
      ?? extractionNotices[result.reason ?? '']
      ?? 'Nothing was updated.',
    )

    return
  }

  if (!result.created && !result.updated && !result.deleted) {
    useInfoMessage('Memory updated', 'Nothing new to remember.')

    return
  }

  useInfoMessage(
    'Memory updated',
    `Added ${result.created}, updated ${result.updated}, `
    + `removed ${result.deleted}.`,
  )
}

async function resetMemory() {
  const confirmation = await useConfirm({
    text: 'Reset your account memory?',
    subtitle: 'This deletes every account memory entry (Profile, '
      + 'Preferences, Topics, Areas, People). Project memory is kept. '
      + 'This cannot be undone.',
    alert: true,
    actions: ['Delete entries'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  isResetting.value = true

  try {
    const { deleted } = await $fetch('/api/v1/memory/entries/reset', {
      method: 'POST',
      body: { scope: 'account' },
    })

    useInfoMessage(
      'Memory reset',
      deleted === 0
        ? 'Nothing to delete.'
        : `Deleted ${deleted} ${pluralize(deleted, 'entry', 'entries')}.`,
    )
    emit('changed')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to reset memory.',
      parsedException.why,
    )
  } finally {
    isResetting.value = false
  }
}
</script>
