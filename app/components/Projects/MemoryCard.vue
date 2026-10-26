<template>
  <UiBubble class="mb-4 !block bg-base-100 dark:bg-base-100/10 shadow-none">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          Project memory
        </h2>
        <p
          v-if="automaticUpdates"
          class="mt-1 text-sm opacity-70"
          data-testid="project-memory-hint"
        >
          Updates automatically after chats in this project; turn it off per
          project.
        </p>
        <p
          v-else
          class="mt-1 text-sm opacity-70"
          data-testid="project-memory-hint"
        >
          Automatic updates are off. Use Refresh memory, or turn on Generate
          memory from chats in
          <NuxtLink
            to="/profile/memory"
            class="link"
            data-testid="project-memory-settings-link"
          >Memory settings</NuxtLink>.
        </p>
      </div>
      <div
        v-if="displayStatusBadge"
        class="badge badge-ghost badge-sm shrink-0"
        :class="statusBadgeClass"
        :title="statusExplanation ?? undefined"
        data-testid="project-memory-status"
      >
        {{ statusLabel }}
        <span
          v-if="statusExplanation"
          class="sr-only"
          data-testid="project-memory-status-explanation"
        > {{ statusExplanation }}</span>
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
          <ProfileMemoryEntriesEssentials
            heading="Essentials"
            :entries="essentialEntries"
            @select="openEntry"
          />
          <ProfileMemoryEntriesGroup
            v-for="group in otherGroups"
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
          Nothing remembered for this project yet.
          {{ emptyStateGuidance }}
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

    <div
      v-if="card"
      class="
        mt-4 flex flex-col gap-3 border-t border-base-200/80 pt-4
        sm:flex-row sm:items-start sm:justify-between sm:gap-4
      "
      data-testid="project-memory-account"
    >
      <label class="flex min-w-0 cursor-pointer items-start justify-between gap-4 sm:flex-1">
        <span class="grid min-w-0 gap-1">
          <span
            :id="`${idPrefix}-account-title`"
            class="text-sm font-bold"
          >Use account memory</span>
          <span
            :id="`${idPrefix}-account-description`"
            class="text-sm text-base-content/70"
          >
            Share memory between this project and your chats outside of
            projects. When off, chats in this project use only project memory
            and search only this project's chats.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle mt-1 shrink-0"
          :aria-labelledby="`${idPrefix}-account-title`"
          :aria-describedby="`${idPrefix}-account-description`"
          data-testid="project-memory-account-toggle"
          :checked="card.useAccountMemory"
          :disabled="isSavingAccountMemory"
          @change="onAccountMemoryChange"
        >
      </label>
      <NuxtLink
        to="/profile/memory"
        class="link shrink-0 text-sm"
        data-testid="view-account-memory"
      >
        View account memory
      </NuxtLink>
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
          v-if="card && !isDisabled"
          type="button"
          data-testid="project-memory-add"
          class="btn btn-ghost btn-ghost-legacy btn-sm max-sm:btn-block max-sm:order-2"
          @click="openCreate"
        >
          Add memory
        </button>
        <button
          type="button"
          data-testid="toggle-project-memory"
          class="btn btn-sm max-sm:btn-block max-sm:order-3"
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
          class="btn btn-ghost btn-ghost-legacy btn-sm max-sm:btn-block max-sm:order-4"
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
      :project-id="projectId"
      :taken-singleton-categories="takenSingletonCategories"
      @changed="emit('changed')"
    />
  </UiBubble>
</template>

<script setup lang="ts">
import { alwaysInjectedMemoryCategories } from '#shared/utils/memory-policy'
import type { MemoryCategory, MemoryEntry } from '#shared/types/memory.d'
import type { MemoryEntryGroup } from '#shared/types/memory-api.d'
import type { ProjectMemoryCardResponse } from '#shared/types/project-memory.d'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'

const props = withDefaults(defineProps<{
  projectId: string
  card: ProjectMemoryCardResponse | null
  isRefreshing: boolean
  isToggling: boolean
  automaticUpdates?: boolean
  isSavingAccountMemory?: boolean
}>(), {
  automaticUpdates: false,
  isSavingAccountMemory: false,
})

const emit = defineEmits<{
  'refresh': []
  'toggle': []
  'changed': []
  'update-account-memory': [useAccountMemory: boolean]
}>()

const idPrefix = useId()

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

function isEssentialCategory(category: MemoryCategory): boolean {
  return (alwaysInjectedMemoryCategories as readonly string[])
    .includes(category)
}

const essentialEntries = computed<MemoryEntry[]>(() => {
  return orderedGroups.value
    .filter(group => isEssentialCategory(group.category))
    .flatMap(group => group.entries)
})

const otherGroups = computed<MemoryEntryGroup[]>(() => {
  return orderedGroups.value.filter((group) => {
    return !isEssentialCategory(group.category)
  })
})

const takenSingletonCategories = computed<MemoryCategory[]>(() => {
  return [...new Set(essentialEntries.value.map(entry => entry.category))]
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
      return 'Out of date'
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

const statusExplanation = computed<string | null>(() => {
  if (memoryStatus.value !== 'stale') {
    return null
  }

  if (props.automaticUpdates) {
    return 'It will update after your next chat in this project, or use '
      + 'Refresh memory.'
  }

  return 'Not updated automatically. Use Refresh memory to update it.'
})

const emptyStateGuidance = computed<string>(() => {
  if (props.automaticUpdates) {
    return 'It will build up from chats in this project.'
  }

  return 'Use Refresh memory to build it from this project\'s chats.'
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

function onAccountMemoryChange(event: Event) {
  const input = event.target as HTMLInputElement

  emit('update-account-memory', input.checked)
}

function openEntry(entry: MemoryEntry) {
  selectedEntry.value = entry
  isDetailOpen.value = true
}

function openCreate() {
  selectedEntry.value = null
  isDetailOpen.value = true
}
</script>
