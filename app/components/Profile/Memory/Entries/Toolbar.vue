<template>
  <div class="grid gap-2">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
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
      <div class="flex flex-wrap items-center gap-2 sm:justify-end">
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
        <UiButton
          v-if="canUpdateNow"
          size="sm"
          normal-case
          :text="isUpdating ? 'Updating...' : 'Update memory now'"
          :disabled="isUpdating"
          data-testid="memory-update-now"
          @click="updateMemoryNow"
        >
          <template #icon>
            <span
              v-if="isUpdating"
              class="loading loading-spinner loading-xs"
            />
            <Icon
              v-else
              name="lucide:refresh-cw"
              size="16"
            />
          </template>
        </UiButton>
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
    </div>
    <p
      v-if="canUpdateNow"
      class="text-xs text-base-content/60"
      data-testid="memory-update-now-note"
    >
      {{ updateNowNote }}
    </p>
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

const isUpdating = shallowRef<boolean>(false)
const isResetting = shallowRef<boolean>(false)

const canUpdateNow = computed<boolean>(() => {
  return props.settings.memoryEnabled
    && props.settings.memoryExtractionEnabled
})

const isResetDisabled = computed<boolean>(() => {
  return !props.total || isResetting.value
})

const updateNowNote = 'Reads your latest account chat and runs on your own '
  + 'API key.'

const extractionNotices: Record<string, string> = {
  'leased': 'Besidka is already updating memory from this chat.',
  'no-user-text': 'No new messages to read since the last update.',
  'too-short': 'Your latest chat is too short to learn from yet.',
  'disabled': 'Memory generation is turned off.',
  'project-unavailable': 'This project is no longer available.',
  'chat-unavailable': 'Your latest chat is no longer available.',
}

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

async function updateMemoryNow() {
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
