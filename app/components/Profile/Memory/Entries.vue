<template>
  <div data-testid="memory-entries-section">
    <ProfileSecuritySectionCard
      heading="What Besidka remembers"
      :description="description"
    >
      <div class="grid gap-4">
        <div
          v-if="!settings.memoryEnabled"
          role="status"
          class="alert alert-soft alert-warning"
          data-testid="memory-disabled-note"
        >
          <Icon
            name="lucide:circle-alert"
            size="20"
            class="shrink-0"
          />
          <span>Memory is off. Entries are kept but not used in chats.</span>
        </div>
        <ProfileMemoryEntriesToolbar
          :settings="settings"
          :project-id="projectId"
          :total="data?.total ?? null"
          :limit="entryLimit"
          @scope-change="changeScope"
          @changed="refresh()"
        />
        <div
          v-if="isInitialLoading"
          class="grid gap-2"
          aria-busy="true"
          data-testid="memory-entries-skeleton"
        >
          <div
            v-for="rowIndex in 3"
            :key="rowIndex"
            class="skeleton skeleton--default h-20 w-full"
          />
        </div>
        <div
          v-else-if="parsedError"
          role="alert"
          class="alert alert-soft alert-error !items-start"
          data-testid="memory-entries-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="20"
            class="mt-0.5 shrink-0"
          />
          <div class="grid gap-1">
            <p class="font-bold">
              {{ parsedError.message || 'Failed to load memory.' }}
            </p>
            <p v-if="parsedError.why" class="text-sm">{{ parsedError.why }}</p>
            <p v-if="parsedError.fix" class="text-sm">{{ parsedError.fix }}</p>
          </div>
          <UiButton
            mode="error"
            outline
            size="sm"
            normal-case
            text="Try again"
            data-testid="memory-entries-retry"
            @click="refresh()"
          />
        </div>
        <ProfileMemoryEntriesEmpty
          v-else-if="orderedGroups.length === 0"
          :settings="settings"
          :project-id="projectId"
        />
        <div
          v-else
          class="grid gap-6"
          data-testid="memory-entries-list"
        >
          <ProfileMemoryEntriesGroup
            v-for="group in orderedGroups"
            :key="group.category"
            :category="group.category"
            :entries="group.entries"
            @select="openEntry"
          />
        </div>
      </div>
    </ProfileSecuritySectionCard>
    <LazyProfileMemoryEntriesDetailModal
      v-if="data"
      v-model:open="isDetailOpen"
      :entry="selectedEntry"
      :limits="data.limits"
      @changed="refresh()"
    />
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { MemoryEntry, MemorySettingsFields } from '#shared/types/memory.d'
import type { MemoryEntryGroup } from '#shared/types/memory-api.d'

defineProps<{
  settings: MemorySettingsFields
}>()

const description = 'Everything Besidka keeps about you, grouped by '
  + 'category. Edit or delete anything.'

const route = useRoute()
const router = useRouter()

const selectedEntry = shallowRef<MemoryEntry | null>(null)
const isDetailOpen = shallowRef<boolean>(false)

const projectId = computed<string | null>(() => {
  const { scope, project } = route.query

  if (scope !== 'project' || typeof project !== 'string' || !project) {
    return null
  }

  return project
})

const entriesKey = computed<string>(() => {
  return `memory-entries:${projectId.value ?? 'account'}`
})

const entriesQuery = computed(() => {
  if (projectId.value) {
    return { scope: 'project', projectId: projectId.value }
  }

  return { scope: 'account' }
})

const { data, pending, error, refresh } = await useLazyFetch(
  '/api/v1/memory/entries',
  {
    key: entriesKey,
    query: entriesQuery,
  },
)

const isInitialLoading = computed<boolean>(() => {
  return pending.value && !data.value
})

const parsedError = computed(() => {
  return error.value ? parseError(error.value) : null
})

const entryLimit = computed<number | null>(() => {
  if (!data.value) {
    return null
  }

  return projectId.value
    ? data.value.limits.maxProjectEntries
    : data.value.limits.maxAccountEntries
})

const orderedGroups = computed<MemoryEntryGroup[]>(() => {
  const groups = data.value?.groups ?? []

  return memoryCategoryOrder.flatMap((category) => {
    return groups.filter((group) => {
      return group.category === category && group.entries.length > 0
    })
  })
})

async function changeScope(nextProjectId: string | null) {
  const query = { ...route.query }

  delete query.scope
  delete query.project

  if (nextProjectId) {
    query.scope = 'project'
    query.project = nextProjectId
  }

  await router.replace({ query })
}

function openEntry(entry: MemoryEntry) {
  selectedEntry.value = entry
  isDetailOpen.value = true
}
</script>
