<template>
  <li
    class="min-w-0"
    :data-project-id="id"
    data-testid="memory-project"
  >
    <h4>
      <button
        ref="toggleButton"
        type="button"
        class="js-memory-project-toggle rounded-box flex w-full items-center gap-2 p-3 text-left hover:bg-base-content/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        :aria-expanded="isExpanded"
        :aria-controls="regionId"
        data-testid="memory-project-toggle"
        @click="toggle"
      >
        <Icon
          name="lucide:chevron-right"
          size="16"
          class="shrink-0 transition-transform motion-reduce:transition-none"
          :class="{ 'rotate-90': isExpanded }"
        />
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="max-w-full truncate font-medium"
            data-testid="memory-project-name"
          >
            {{ name }}
          </span>
          <span
            class="badge badge-ghost badge-sm"
            data-testid="memory-project-count"
          >
            {{ entries.length }} of {{ limit }}
          </span>
          <span
            v-if="isMemoryOff"
            class="badge badge-soft badge-warning badge-sm"
            data-testid="memory-project-off"
          >
            Memory off
          </span>
        </span>
      </button>
    </h4>
    <div
      v-if="isExpanded"
      :id="regionId"
      class="ml-4 mt-1 grid gap-3 border-l border-base-content/10 pl-3 sm:ml-6"
      data-testid="memory-project-panel"
    >
      <div class="flex flex-wrap items-center gap-2">
        <NuxtLink
          :to="`/chats/projects/${id}`"
          class="btn btn-ghost btn-ghost-legacy btn-sm"
          data-testid="memory-project-open"
        >
          <Icon name="lucide:folder-open" size="16" />
          Open project
        </NuxtLink>
        <UiButton
          size="sm"
          normal-case
          icon-name="lucide:plus"
          text="Add memory"
          data-testid="memory-project-add"
          @click="emit('add', id)"
        />
        <UiButton
          mode="error"
          ghost
          size="sm"
          normal-case
          text="Reset project memory…"
          :disabled="isResetting"
          data-testid="memory-project-reset"
          @click="resetProjectMemory"
        />
      </div>
      <ul class="grid gap-2">
        <li
          v-for="entry in entries"
          :key="entry.id"
        >
          <ProfileMemoryEntriesRow
            :entry="entry"
            :label="memoryCategoryLabels[entry.category]"
            @select="emit('select', $event)"
          />
        </li>
      </ul>
    </div>
  </li>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { MemoryEntry } from '#shared/types/memory.d'

const props = defineProps<{
  id: string
  name: string
  entries: MemoryEntry[]
  limit: number
  isMemoryOff: boolean
  focusRequested: boolean
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
  add: [projectId: string]
  changed: []
  focused: []
}>()

const toggleButton = useTemplateRef<HTMLButtonElement>('toggleButton')
const isExpanded = shallowRef<boolean>(false)
const isResetting = shallowRef<boolean>(false)
const regionId = useId()

function toggle() {
  isExpanded.value = !isExpanded.value
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

async function revealAndFocus() {
  isExpanded.value = true

  await nextTick()

  toggleButton.value?.scrollIntoView({ block: 'center' })
  toggleButton.value?.focus()
  emit('focused')
}

onMounted(async () => {
  if (!props.focusRequested) {
    return
  }

  await revealAndFocus()
})

watch(() => props.focusRequested, async (isRequested) => {
  if (!isRequested) {
    return
  }

  await revealAndFocus()
}, { flush: 'post' })

async function resetProjectMemory() {
  const confirmation = await useConfirm({
    text: `Reset memory for "${props.name}"?`,
    subtitle: 'This deletes every memory entry in this project. '
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
      body: { scope: 'project', projectId: props.id },
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
      parsedException.message || 'Failed to reset project memory.',
      parsedException.why,
    )
  } finally {
    isResetting.value = false
  }
}
</script>
