<template>
  <div
    class="grid grid-cols-[minmax(0,1fr)] gap-5"
    data-testid="connector-directory"
  >
    <form
      role="search"
      class="grid gap-1"
      @submit.prevent="loadList(0)"
    >
      <label
        for="connector-directory-query"
        class="sr-only"
      >
        Search connectors
      </label>
      <label class="input w-full">
        <Icon
          name="lucide:search"
          size="16"
          class="opacity-60"
          aria-hidden="true"
        />
        <input
          id="connector-directory-query"
          v-model="query"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :maxlength="REGISTRY_SEARCH_QUERY_MAX_LENGTH"
          placeholder="Search connectors by name or what they do"
          class="min-w-0 grow"
          data-testid="connector-directory-query"
        >
      </label>
    </form>

    <div
      v-if="isAdmin"
      class="flex flex-wrap items-center gap-2 rounded-box bg-base-200 px-3 py-2 text-xs"
      data-testid="connector-registry-admin"
    >
      <p
        class="min-w-0 grow text-base-content/70"
        data-testid="connector-registry-admin-status"
      >
        {{ adminStatusText }}
      </p>
      <button
        type="button"
        class="btn btn-sm min-h-11 sm:min-h-8"
        :disabled="isSyncing"
        data-testid="connector-registry-sync-now"
        @click="syncNow"
      >
        <span
          v-if="isSyncing"
          class="loading loading-spinner loading-xs"
          aria-hidden="true"
        />
        Sync now
      </button>
    </div>

    <p
      class="sr-only"
      aria-live="polite"
    >
      {{ liveMessage }}
    </p>

    <section
      v-if="isListMode"
      class="grid grid-cols-[minmax(0,1fr)] gap-3"
      aria-labelledby="connector-directory-list-heading"
      data-testid="connector-directory-list"
    >
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="!isSearchActive"
          type="button"
          class="btn btn-ghost btn-sm min-h-11 sm:min-h-8"
          data-testid="connector-directory-back"
          @click="closeList"
        >
          <Icon
            name="lucide:arrow-left"
            size="16"
            aria-hidden="true"
          />
          Back
        </button>
        <h3
          id="connector-directory-list-heading"
          class="flex items-center gap-2 text-sm font-semibold"
        >
          {{ listHeading }}
          <span
            v-if="total !== null"
            class="badge badge-soft badge-sm"
            data-testid="connector-directory-total"
          >
            {{ total }}
          </span>
        </h3>
      </div>

      <p
        v-if="listError"
        class="text-sm text-error"
        role="alert"
        data-testid="connector-directory-error"
      >
        {{ listError }}
      </p>
      <p
        v-else-if="isListLoaded && !items.length && !isListLoading"
        class="text-sm text-base-content/70"
        data-testid="connector-directory-empty"
      >
        Nothing found. Try another word, or add the server by its address.
      </p>

      <ul
        v-if="items.length"
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        data-testid="connector-directory-results"
      >
        <ProfileConnectorsDirectoryCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          :is-adding="actions.isAdding.value"
          @open="actions.openEntry"
          @add="addItem"
        />
      </ul>
      <div
        v-else-if="isListLoading"
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        aria-hidden="true"
        data-testid="connector-directory-skeleton"
      >
        <div class="skeleton skeleton--default h-28 w-full rounded-box" />
        <div class="skeleton skeleton--default h-28 w-full rounded-box" />
      </div>

      <button
        v-if="nextCursor !== null"
        type="button"
        class="btn btn-ghost btn-sm justify-self-center min-h-11 sm:min-h-8"
        :disabled="isListLoading"
        data-testid="connector-directory-more"
        @click="loadList(nextCursor)"
      >
        Show more
      </button>
    </section>

    <template v-else>
      <p
        v-if="homeError"
        class="text-sm text-error"
        role="alert"
        data-testid="connector-directory-error"
      >
        The directory failed to load.
      </p>
      <p
        v-else-if="home?.syncing"
        class="text-sm text-base-content/70"
        data-testid="connector-directory-syncing"
      >
        The directory is still being copied. Try again later.
      </p>
      <div
        v-else-if="!home"
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        aria-hidden="true"
        data-testid="connector-directory-skeleton"
      >
        <div
          v-for="index in 4"
          :key="index"
          class="skeleton skeleton--default h-28 w-full rounded-box"
        />
      </div>

      <section
        v-for="section in homeSections"
        :key="section.id"
        class="grid grid-cols-[minmax(0,1fr)] gap-2"
        :aria-labelledby="`connector-directory-${section.id}`"
        :data-testid="`connector-directory-section-${section.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <h3
            :id="`connector-directory-${section.id}`"
            class="flex items-center gap-2 text-sm font-semibold"
          >
            {{ section.label }}
            <span class="badge badge-soft badge-sm">{{ section.count }}</span>
          </h3>
          <button
            v-if="section.count > section.items.length"
            type="button"
            class="btn btn-ghost btn-sm min-h-11 sm:min-h-8"
            :aria-label="`Show all ${section.label}`"
            :data-testid="`connector-directory-show-all-${section.id}`"
            @click="openList(section)"
          >
            Show all
          </button>
        </div>
        <ul class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          <ProfileConnectorsDirectoryCard
            v-for="item in section.items"
            :key="item.id"
            :item="item"
            :is-adding="actions.isAdding.value"
            @open="actions.openEntry"
            @add="addItem"
          />
        </ul>
      </section>
    </template>

    <p class="text-xs text-base-content/70">
      From the Official MCP Registry. Not reviewed by Besidka.
      {{ CONNECTOR_CATALOG_FOOTER }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { CONNECTOR_CATALOG_FOOTER } from '~~/config/connectors-catalog'
import {
  REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  REGISTRY_SEARCH_QUERY_MIN_LENGTH,
} from '#shared/utils/connectors-policy'
import type {
  ConnectorDirectoryHome,
  ConnectorDirectoryItem,
} from '#shared/types/connectors.d'

interface SyncStatus {
  rows: number
  lastSyncedAt: string | null
  hasUnfinishedRun: boolean
  isRunning: boolean
}

interface DirectorySection {
  id: string
  label: string
  count: number
  items: ConnectorDirectoryItem[]
  view: 'top' | 'new' | 'category'
}

const SEARCH_DEBOUNCE_MS = 250
const MAX_SYNC_RUNS = 12

const isAdmin = useIsAdmin()
const actions = useConnectorDirectoryActions()
const { connectors } = useConnectorsPage()

const {
  data: homeData,
  error: homeError,
  refresh: refreshHome,
} = await useLazyFetch('/api/v1/connectors/registry/home', {
  server: false,
})

const query = shallowRef<string>('')
const openSection = shallowRef<DirectorySection | null>(null)
const items = shallowRef<ConnectorDirectoryItem[]>([])
const nextCursor = shallowRef<number | null>(null)
const total = shallowRef<number | null>(null)
const isListLoading = shallowRef<boolean>(false)
const isListLoaded = shallowRef<boolean>(false)
const listError = shallowRef<string>('')
const liveMessage = shallowRef<string>('')
const syncStatus = shallowRef<SyncStatus | null>(null)
const isSyncing = shallowRef<boolean>(false)
const syncMessage = shallowRef<string>('')
let latestRequest = 0

const home = computed<ConnectorDirectoryHome | null>(() => {
  return (homeData.value ?? null) as ConnectorDirectoryHome | null
})

const trimmedQuery = computed<string>(() => query.value.trim())

const isSearchActive = computed<boolean>(() => {
  return trimmedQuery.value.length >= REGISTRY_SEARCH_QUERY_MIN_LENGTH
})

const isListMode = computed<boolean>(() => {
  return isSearchActive.value || openSection.value !== null
})

const listHeading = computed<string>(() => {
  if (isSearchActive.value) {
    return 'Results'
  }

  return openSection.value?.label ?? ''
})

const homeSections = computed<DirectorySection[]>(() => {
  const value = home.value

  if (!value || value.syncing) {
    return []
  }

  const sections: DirectorySection[] = [
    {
      id: 'top',
      label: 'Top connectors',
      count: value.topCount,
      items: value.top,
      view: 'top',
    },
    {
      id: 'new',
      label: 'New connectors',
      count: value.newCount,
      items: value.new,
      view: 'new',
    },
    ...value.categories.map((category) => {
      return { ...category, view: 'category' as const }
    }),
  ]

  return sections.filter(section => section.items.length > 0)
})

const adminStatusText = computed<string>(() => {
  if (syncMessage.value) {
    return syncMessage.value
  }

  if (!syncStatus.value) {
    return 'Admin: the directory copy is filled by the hourly sync.'
  }

  const { rows, lastSyncedAt } = syncStatus.value
  const synced = lastSyncedAt
    ? `last synced ${new Date(lastSyncedAt).toLocaleString()}`
    : 'never synced'

  return `Admin: ${rows} entries copied, ${synced}.`
})

function buildListQuery(cursor: number): Record<string, string | number> {
  const section = openSection.value
  const listQuery: Record<string, string | number> = {}

  if (isSearchActive.value) {
    listQuery.q = trimmedQuery.value
  } else if (section?.view === 'category') {
    listQuery.category = section.id
  } else if (section) {
    listQuery.view = section.view
  }

  if (cursor > 0) {
    listQuery.cursor = cursor
  }

  return listQuery
}

async function loadList(cursor: number) {
  if (!isListMode.value) {
    return
  }

  const request = ++latestRequest

  isListLoading.value = true
  listError.value = ''

  if (cursor === 0) {
    items.value = []
    isListLoaded.value = false
  }

  try {
    const result = await $fetch('/api/v1/connectors/registry', {
      query: buildListQuery(cursor),
    })

    if (request !== latestRequest) {
      return
    }

    const found = result.items as ConnectorDirectoryItem[]

    items.value = cursor > 0 ? [...items.value, ...found] : found
    nextCursor.value = result.nextCursor
    total.value = cursor > 0 ? total.value : result.total
    isListLoaded.value = true
    liveMessage.value = `${items.value.length} connectors shown`
  } catch (exception) {
    if (request !== latestRequest) {
      return
    }

    listError.value = parseError(exception).message
      || 'The directory failed to load'
  } finally {
    if (request === latestRequest) {
      isListLoading.value = false
    }
  }
}

async function openList(section: DirectorySection) {
  openSection.value = section
  await loadList(0)
}

function closeList() {
  openSection.value = null
  items.value = []
  total.value = null
  nextCursor.value = null
}

async function addItem(item: ConnectorDirectoryItem) {
  await actions.add(item)
}

async function reloadCurrent() {
  if (isListMode.value) {
    await loadList(0)

    return
  }

  await refreshHome()
}

async function loadSyncStatus() {
  if (!isAdmin.value) {
    return
  }

  try {
    syncStatus.value = await $fetch('/api/v1/admin/connectors/registry')
  } catch {
    syncStatus.value = null
  }
}

async function syncNow() {
  isSyncing.value = true
  syncMessage.value = 'Syncing the directory...'

  try {
    for (let run = 0; run < MAX_SYNC_RUNS; run += 1) {
      const result = await $fetch('/api/v1/admin/connectors/registry/sync', {
        method: 'POST',
      })

      syncStatus.value = result
      syncMessage.value = `Syncing: ${result.rows} entries copied...`

      if (result.outcome === 'busy' || result.outcome === 'failed') {
        syncMessage.value = result.outcome === 'busy'
          ? 'A sync is already running.'
          : `The sync failed: ${result.error ?? 'unknown error'}`

        break
      }

      if (result.outcome === 'completed') {
        syncMessage.value = ''

        break
      }

      if (run === MAX_SYNC_RUNS - 1) {
        syncMessage.value = `${result.rows} entries copied so far. Press `
          + 'Sync now again to continue.'
      }
    }
  } catch (exception) {
    syncMessage.value = parseError(exception).message
      || 'The sync could not run'
  } finally {
    isSyncing.value = false
  }

  await reloadCurrent()
}

watchDebounced(trimmedQuery, async () => {
  await loadList(0)
}, { debounce: SEARCH_DEBOUNCE_MS })

watch(() => connectors.value.length, async () => {
  await reloadCurrent()
})

onMounted(loadSyncStatus)
</script>
