<template>
  <UiBubble class="mb-4 !block bg-base-100 dark:bg-base-100/10 shadow-none">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          Project memory
        </h2>
        <p class="mt-1 text-sm opacity-70">
          Projects keep their memory up to date automatically; turn it off
          per project.
        </p>
      </div>
      <div
        v-if="displayStatusBadge"
        class="badge badge-ghost badge-sm shrink-0"
        :class="statusBadgeClass"
        data-testid="project-memory-status"
      >
        {{ statusLabel }}
      </div>
    </div>

    <div
      v-if="metaLines.length"
      class="mt-2 text-xs opacity-60"
      data-testid="project-memory-meta"
    >
      <p
        v-for="line in metaLines"
        :key="line"
      >
        {{ line }}
      </p>
    </div>

    <div class="mt-4 grid gap-4">
      <p
        v-if="isDisabled"
        class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
        data-testid="project-memory-disabled"
      >
        Project memory is off. Turn it on to keep it up to date from this
        project's chats.
      </p>
      <template v-else-if="card">
        <div
          v-if="hasEntries"
          class="grid gap-4"
          data-testid="project-memory-entries"
        >
          <p
            class="text-xs opacity-60"
            data-testid="project-memory-count"
          >
            {{ card.total }} of {{ card.limits.maxProjectEntries }}<span
              class="sr-only"
            > entries</span>
          </p>
          <ProfileMemoryEntriesGroup
            v-for="group in orderedGroups"
            :key="group.category"
            :category="group.category"
            :entries="group.entries"
            @select="openEntry"
          />
        </div>
        <p
          v-else-if="isUnavailable"
          class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
          data-testid="project-memory-unavailable"
        >
          Project memory can't be built right now. Add a supported API key in
          Profile &gt;
          <NuxtLink
            to="/profile/keys"
            class="link"
          >API Keys</NuxtLink>, then refresh.
        </p>
        <template v-else-if="hasLegacyMemory">
          <p
            v-if="!isRefreshingStatus"
            class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
            data-testid="project-memory-unconverted"
          >
            Nothing converted into entries yet. Refresh memory to turn the
            earlier memory below into entries.
          </p>
        </template>
        <p
          v-else
          class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
          data-testid="project-memory-empty"
        >
          Nothing remembered for this project yet. Memory builds up from this
          project's chats.
        </p>
        <details
          v-if="card.legacyMemory"
          class="collapse collapse-arrow rounded-box border border-base-200/80"
          data-testid="project-memory-legacy"
        >
          <summary class="collapse-title text-sm font-semibold">
            Earlier project memory (not converted yet)
          </summary>
          <div class="collapse-content">
            <div class="max-h-[min(300px,33dvh)] overflow-y-auto">
              <MDCCached
                :value="card.legacyMemory"
                :cache-key="legacyCacheKey"
                :components="messageComponents"
                :parser-options="{ highlight: false }"
                class="chat-markdown text-sm"
              />
            </div>
          </div>
        </details>
      </template>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-end gap-3">
      <div class="max-sm:grid max-sm:w-full sm:flex sm:flex-row-reverse sm:items-center gap-2">
        <button
          v-if="!isDisabled"
          type="button"
          data-testid="refresh-project-memory"
          class="btn btn-primary btn-sm max-sm:btn-block max-sm:order-1"
          :disabled="isRefreshing || isToggling"
          @click="emit('refresh')"
        >
          <span
            v-if="isRefreshing"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>
            Refresh memory
          </span>
        </button>
        <button
          type="button"
          data-testid="toggle-project-memory"
          class="btn btn-sm max-sm:btn-block max-sm:order-2"
          :class="isDisabled ? 'btn-primary' : 'btn-ghost'"
          :disabled="isRefreshing || isToggling"
          @click="emit('toggle')"
        >
          <span
            v-if="isToggling"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>
            {{ isDisabled ? 'Enable memory' : 'Disable memory' }}
          </span>
        </button>
        <NuxtLink
          :to="{
            path: '/profile/memory',
            query: { scope: 'project', project: projectId },
          }"
          class="btn btn-ghost btn-ghost-legacy btn-sm max-sm:btn-block max-sm:order-3"
          data-testid="manage-project-memory-entries"
        >
          Open in Memory
        </NuxtLink>
      </div>
    </div>

    <LazyProfileMemoryEntriesDetailModal
      v-if="card"
      v-model:open="isDetailOpen"
      :entry="selectedEntry"
      :limits="card.limits"
      @changed="emit('changed')"
    />
  </UiBubble>
</template>

<script setup lang="ts">
import type { MemoryEntry } from '#shared/types/memory.d'
import type { MemoryEntryGroup } from '#shared/types/memory-api.d'
import type { ProjectMemoryCardResponse } from '#shared/types/project-memory.d'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'

const props = defineProps<{
  projectId: string
  card: ProjectMemoryCardResponse | null
  isRefreshing: boolean
  isToggling: boolean
}>()

const emit = defineEmits<{
  refresh: []
  toggle: []
  changed: []
}>()

const { messageComponents } = useChatFormat()

const selectedEntry = shallowRef<MemoryEntry | null>(null)
const isDetailOpen = shallowRef<boolean>(false)

const memoryStatus = computed<ProjectMemoryStatus>(() => {
  return props.card?.memoryStatus ?? 'idle'
})

const isDisabled = computed<boolean>(() => {
  return memoryStatus.value === 'disabled'
})

const isUnavailable = computed<boolean>(() => {
  return memoryStatus.value === 'unavailable'
})

const isRefreshingStatus = computed<boolean>(() => {
  return memoryStatus.value === 'refreshing'
})

const hasLegacyMemory = computed<boolean>(() => {
  return !!props.card?.legacyMemory?.trim()
})

const displayStatusBadge = computed<boolean>(() => {
  if (!props.card) {
    return false
  }

  if (memoryStatus.value === 'idle') {
    return !hasEntries.value && !hasLegacyMemory.value
  }

  return memoryStatus.value !== 'ready'
})

const hasEntries = computed<boolean>(() => {
  return (props.card?.total ?? 0) > 0
})

const orderedGroups = computed<MemoryEntryGroup[]>(() => {
  const groups = props.card?.groups ?? []

  return memoryCategoryOrder.flatMap((category) => {
    return groups.filter((group) => {
      return group.category === category && group.entries.length > 0
    })
  })
})

const legacyCacheKey = computed<string>(() => {
  return [
    'project-memory-legacy',
    props.projectId,
    props.card?.legacyMemory?.length ?? 0,
  ].join(':')
})

const statusLabel = computed<string>(() => {
  switch (memoryStatus.value) {
    case 'refreshing':
      return 'Refreshing'
    case 'stale':
      return 'Stale'
    case 'failed':
      return 'Failed'
    case 'unavailable':
      return 'Unavailable'
    case 'disabled':
      return 'Disabled'
    default:
      return 'Empty'
  }
})

const statusBadgeClass = computed<string>(() => {
  switch (memoryStatus.value) {
    case 'refreshing':
      return 'badge-info badge-outline'
    case 'stale':
      return 'badge-warning badge-outline'
    case 'failed':
      return 'badge-error badge-outline'
    default:
      return ''
  }
})

const metaLines = computed<string[]>(() => {
  if (!props.card) {
    return []
  }

  const {
    memoryProvider,
    memoryModel,
    memoryUpdatedAt,
    memoryError,
  } = props.card
  const lines: string[] = []

  if (memoryProvider && memoryModel) {
    lines.push(`Model: ${memoryProvider} / ${memoryModel}`)
  }

  if (memoryUpdatedAt) {
    lines.push(`Updated ${formatMemoryUpdatedAge(new Date(memoryUpdatedAt))}`)
  }

  if (memoryError?.trim()) {
    lines.push(memoryError.trim())
  }

  return lines
})

function openEntry(entry: MemoryEntry) {
  selectedEntry.value = entry
  isDetailOpen.value = true
}
</script>
