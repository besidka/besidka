<template>
  <div
    data-testid="reasoning-memory-step"
    class="my-2.5 min-w-0 flex-1"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <button
        type="button"
        :aria-expanded="isExpandable ? isExpanded : undefined"
        :aria-controls="isExpandable && isExpanded ? contentId : undefined"
        :disabled="!isExpandable"
        data-testid="reasoning-memory-step-trigger"
        class="
          flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5
          text-left text-xs disabled:cursor-default
        "
        :class="isExpandable ? 'cursor-pointer' : undefined"
        @click="toggle"
      >
        <span
          data-testid="reasoning-memory-step-title"
          class="order-1 min-w-0"
          :class="
            props.pending
              ? 'skeleton skeleton-text reasoning-main-title-skeleton'
              : undefined
          "
        >
          {{ title }}{{ props.pending ? '…' : '' }}
        </span>
        <Icon
          v-if="isExpandable"
          name="lucide:chevron-right"
          class="
            order-2 size-4 shrink-0 transition-transform sm:order-3
          "
          :class="isExpanded ? 'rotate-90' : undefined"
        />
        <span
          v-if="hasMeta"
          data-testid="reasoning-memory-step-meta"
          class="
            order-3 flex min-w-0 basis-full items-center gap-1.5
            sm:order-2 sm:basis-auto
          "
        >
          <span
            v-if="subjectEntry"
            :title="subjectEntry.title"
            data-testid="reasoning-memory-step-entry-title"
            class="min-w-0 truncate text-base-content/60"
          >
            “{{ subjectEntry.title }}”
          </span>
          <span
            v-if="subjectEntry"
            data-testid="reasoning-memory-step-entry-category"
            class="badge badge-soft badge-xs shrink-0"
          >
            {{ getMemoryCategoryLabel(subjectEntry.category) }}
          </span>
          <span
            v-if="countLabel.length > 0"
            data-testid="reasoning-memory-step-count"
            class="shrink-0 text-base-content/60"
          >
            {{ countLabel }}
          </span>
        </span>
      </button>
      <button
        v-if="canUndo"
        type="button"
        :disabled="isUndoing || isUndone"
        :aria-label="undoLabel"
        data-testid="reasoning-memory-step-undo"
        class="btn btn-ghost btn-xs order-4"
        @click="undo"
      >
        {{ isUndone ? 'Undone' : 'Undo' }}
      </button>
      <span
        aria-live="polite"
        aria-atomic="true"
        data-testid="reasoning-memory-step-undo-status"
        class="sr-only"
      >
        {{ isUndone ? 'Undone' : '' }}
      </span>
    </div>
    <div
      v-if="isExpanded"
      :id="contentId"
      class="mt-2 min-w-0"
    >
      <p
        v-if="data.state === 'failed'"
        data-testid="reasoning-memory-step-error"
        class="text-xs text-error/80 break-words"
      >
        {{ data.errorReason }}
      </p>
      <ul
        v-else
        data-testid="reasoning-memory-step-entries"
        class="flex flex-col gap-1.5"
      >
        <li
          v-for="(entry, entryIndex) in visibleEntries"
          :key="`${entryIndex}-${entry.id ?? entry.title}`"
          class="flex min-w-0 items-baseline gap-2 text-xs"
        >
          <span
            data-testid="reasoning-memory-step-category"
            class="badge badge-soft badge-xs shrink-0"
          >
            {{ getMemoryCategoryLabel(entry.category) }}
          </span>
          <span
            data-testid="reasoning-memory-step-text"
            class="min-w-0 truncate"
            :title="entry.title"
          >
            {{ entry.title }}
          </span>
        </li>
        <li
          v-if="hiddenEntriesCount > 0"
          data-testid="reasoning-memory-step-more"
          class="text-xs text-base-content/60"
        >
          +{{ hiddenEntriesCount }} more
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  MemoryStepData,
  MemoryStepEntry,
} from '~/types/memory-step.d'

const props = defineProps<{
  data: MemoryStepData
  title: string
  pending: boolean
}>()

const nuxtApp = useNuxtApp()

const contentId = useId()

const isExpanded = shallowRef<boolean>(false)
const isUndoing = shallowRef<boolean>(false)
const isUndone = shallowRef<boolean>(false)

const isListStep = computed<boolean>(() => {
  return props.data.toolName === 'memory_list'
    || props.data.toolName === 'memory_read'
})

const isDone = computed<boolean>(() => {
  return props.data.state === 'done'
})

const visibleEntries = computed<MemoryStepEntry[]>(() => {
  return props.data.entries.slice(0, MEMORY_STEP_MAX_ENTRIES)
})

const hiddenEntriesCount = computed<number>(() => {
  return Math.max(props.data.entries.length - MEMORY_STEP_MAX_ENTRIES, 0)
})

const isExpandable = computed<boolean>(() => {
  if (props.data.state === 'failed') {
    return true
  }

  return isListStep.value && isDone.value && visibleEntries.value.length > 0
})

const countLabel = computed<string>(() => {
  if (!isListStep.value || !isDone.value) {
    return ''
  }

  return formatMemoryEntryCount(props.data.entries.length)
})

const subjectEntry = computed<MemoryStepEntry | null>(() => {
  if (isListStep.value || !isDone.value) {
    return null
  }

  return props.data.entries[0] ?? null
})

const hasMeta = computed<boolean>(() => {
  return !!subjectEntry.value || countLabel.value.length > 0
})

const canUndo = computed<boolean>(() => {
  return canUndoMemoryStep(props.data)
})

const undoLabel = computed<string | undefined>(() => {
  if (isUndone.value) {
    return undefined
  }

  const entryTitle = props.data.entries[0]?.title

  if (!entryTitle) {
    return 'Undo saving to memory'
  }

  return `Undo saving "${entryTitle}" to memory`
})

watch(isExpandable, (expandable) => {
  if (!expandable) {
    isExpanded.value = false
  }
})

function toggle() {
  if (!isExpandable.value) {
    return
  }

  isExpanded.value = !isExpanded.value
}

async function undo() {
  const entryId = props.data.entryId

  if (!entryId || !canUndo.value || isUndoing.value || isUndone.value) {
    return
  }

  const entryUrl = `/api/v1/memory/entries/${encodeURIComponent(entryId)}`

  isUndoing.value = true

  try {
    if (props.data.action === 'created') {
      await $fetch(entryUrl, {
        method: 'DELETE',
      })
    } else {
      await $fetch(entryUrl, {
        method: 'PATCH',
        body: props.data.previous,
      })
    }

    isUndone.value = true
  } catch (exception) {
    const parsedException = parseError(exception)

    if (parsedException.status === 404) {
      isUndone.value = true

      return
    }

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Could not undo',
        parsedException.why,
      )
    })
  } finally {
    isUndoing.value = false
  }
}
</script>
