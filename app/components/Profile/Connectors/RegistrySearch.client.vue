<template>
  <div
    class="grid grid-cols-[minmax(0,1fr)] gap-4"
    data-testid="connector-registry"
  >
    <form
      role="search"
      class="grid gap-1"
      @submit.prevent="searchNow"
    >
      <label
        for="connector-registry-query"
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
          id="connector-registry-query"
          v-model="query"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :maxlength="REGISTRY_SEARCH_QUERY_MAX_LENGTH"
          placeholder="Search connectors by name or what they do"
          class="min-w-0 grow"
          data-testid="connector-registry-query"
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
      v-if="!isSearchActive"
      class="grid grid-cols-[minmax(0,1fr)] gap-2"
      aria-labelledby="connector-featured-heading"
    >
      <h3
        id="connector-featured-heading"
        class="text-sm font-semibold"
      >
        Featured
      </h3>
      <ul
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        data-testid="connector-add-presets"
      >
        <ProfileConnectorsPresetCard
          v-for="preset in CONNECTOR_PRESETS"
          :key="preset.id"
          :preset="preset"
          :is-added="addedPresetIds.has(preset.id)"
          :is-busy="isAdding"
          @add="emit('add-preset', $event)"
        />
      </ul>
    </section>

    <section
      class="grid grid-cols-[minmax(0,1fr)] gap-2"
      aria-labelledby="connector-directory-heading"
    >
      <h3
        id="connector-directory-heading"
        class="flex items-center gap-2 text-sm font-semibold"
      >
        {{ isSearchActive ? 'Results' : 'All connectors' }}
        <span
          v-if="total !== null && !isSyncingDirectory"
          class="badge badge-soft badge-sm"
          data-testid="connector-registry-total"
        >
          {{ total }}
        </span>
      </h3>

      <p
        v-if="errorText"
        class="text-sm text-error"
        role="alert"
        data-testid="connector-registry-error"
      >
        {{ errorText }}
      </p>
      <p
        v-else-if="isSyncingDirectory"
        class="text-sm text-base-content/70"
        data-testid="connector-registry-syncing"
      >
        The directory is still being copied. Try again later.
      </p>
      <p
        v-else-if="hasLoaded && !items.length && !isLoading"
        class="text-sm text-base-content/70"
        data-testid="connector-registry-empty"
      >
        Nothing found. Try another word, or add the server by its address.
      </p>

      <ul
        v-if="items.length"
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        data-testid="connector-registry-results"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="card card-border card-sm"
          data-testid="connector-registry-item"
        >
          <div class="card-body gap-2">
            <div class="flex items-start gap-3">
              <ProfileConnectorsAvatar
                :title="displayName(item)"
                :registry-id="item.id"
                size="lg"
              />
              <div class="min-w-0 grow">
                <p class="truncate font-medium">
                  {{ displayName(item) }}
                </p>
                <p
                  v-if="item.publisher"
                  class="truncate text-xs text-base-content/70"
                  data-testid="connector-registry-publisher"
                >
                  by {{ item.publisher }}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-sm shrink-0 min-h-11 sm:min-h-8"
                :disabled="isAdding || isAdded(item)"
                :aria-label="addLabel(item)"
                data-testid="connector-registry-add"
                @click="emit('add', item)"
              >
                {{ isAdded(item) ? 'Added' : 'Add' }}
              </button>
            </div>
            <p
              v-if="item.description"
              class="line-clamp-2 break-words text-sm text-base-content/80"
            >
              {{ item.description }}
            </p>
            <p class="truncate text-xs text-base-content/70">
              <span class="font-mono">{{ hostOf(item.remoteUrl) }}</span>
              <span aria-hidden="true"> · </span>
              {{ authLabel(item) }}
            </p>
          </div>
        </li>
      </ul>

      <div
        v-else-if="isLoading && !hasLoaded"
        class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
        aria-hidden="true"
        data-testid="connector-registry-skeleton"
      >
        <div class="skeleton skeleton--default h-28 w-full rounded-box" />
        <div class="skeleton skeleton--default h-28 w-full rounded-box" />
      </div>

      <button
        v-if="nextCursor !== null"
        type="button"
        class="btn btn-ghost btn-sm justify-self-center"
        :disabled="isLoading"
        data-testid="connector-registry-more"
        @click="load(nextCursor)"
      >
        Show more
      </button>
    </section>

    <p class="text-xs text-base-content/70">
      From the Official MCP Registry. Not reviewed by Besidka.
      {{ CONNECTOR_CATALOG_FOOTER }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  CONNECTOR_CATALOG_FOOTER,
  CONNECTOR_PRESETS,
} from '~~/config/connectors-catalog'
import {
  REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  REGISTRY_SEARCH_QUERY_MIN_LENGTH,
} from '#shared/utils/connectors-policy'
import type { ConnectorDirectoryItem } from '#shared/types/connectors.d'

interface SyncStatus {
  rows: number
  lastSyncedAt: string | null
  hasUnfinishedRun: boolean
  isRunning: boolean
}

const SEARCH_DEBOUNCE_MS = 250
const MAX_SYNC_RUNS = 12

const props = withDefaults(defineProps<{
  addedPresetIds: ReadonlySet<string>
  isAdding?: boolean
}>(), {
  isAdding: false,
})

const emit = defineEmits<{
  'add': [item: ConnectorDirectoryItem]
  'add-preset': [presetId: string]
}>()

const isAdmin = useIsAdmin()

const query = shallowRef<string>('')
const items = shallowRef<ConnectorDirectoryItem[]>([])
const nextCursor = shallowRef<number | null>(null)
const total = shallowRef<number | null>(null)
const isLoading = shallowRef<boolean>(false)
const isSyncingDirectory = shallowRef<boolean>(false)
const hasLoaded = shallowRef<boolean>(false)
const errorText = shallowRef<string>('')
const liveMessage = shallowRef<string>('')
const syncStatus = shallowRef<SyncStatus | null>(null)
const isSyncing = shallowRef<boolean>(false)
const syncMessage = shallowRef<string>('')
let latestRequest = 0

const trimmedQuery = computed<string>(() => query.value.trim())

const isSearchActive = computed<boolean>(() => {
  return trimmedQuery.value.length >= REGISTRY_SEARCH_QUERY_MIN_LENGTH
})

const effectiveQuery = computed<string>(() => {
  return isSearchActive.value ? trimmedQuery.value : ''
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

function lastSegment(name: string): string {
  return name.split('/').at(-1) || name
}

function displayName(item: ConnectorDirectoryItem): string {
  return item.title || lastSegment(item.name)
}

function hostOf(remoteUrl: string): string {
  try {
    return new URL(remoteUrl).host
  } catch {
    return remoteUrl
  }
}

function authLabel(item: ConnectorDirectoryItem): string {
  return item.authHint === 'header'
    ? 'API key or token'
    : 'Sign in or token'
}

function addLabel(item: ConnectorDirectoryItem): string {
  return `${isAdded(item) ? 'Added' : 'Add'} ${displayName(item)}`
}

function isAdded(item: ConnectorDirectoryItem): boolean {
  return item.isAdded
    || (!!item.presetId && props.addedPresetIds.has(item.presetId))
}

async function load(cursor: number) {
  const request = ++latestRequest

  isLoading.value = true
  errorText.value = ''

  try {
    const result = await $fetch('/api/v1/connectors/registry', {
      query: {
        ...(effectiveQuery.value ? { q: effectiveQuery.value } : {}),
        ...(cursor > 0 ? { cursor } : {}),
      },
    })

    if (request !== latestRequest) {
      return
    }

    const found = result.items as ConnectorDirectoryItem[]

    items.value = cursor > 0 ? [...items.value, ...found] : found
    nextCursor.value = result.nextCursor
    total.value = cursor > 0 ? total.value : result.total
    isSyncingDirectory.value = result.syncing === true
    hasLoaded.value = true
    liveMessage.value = `${items.value.length} connectors shown`
  } catch (exception) {
    if (request !== latestRequest) {
      return
    }

    const parsedException = parseError(exception)

    errorText.value = parsedException.message || 'The directory failed to load'
  } finally {
    if (request === latestRequest) {
      isLoading.value = false
    }
  }
}

async function searchNow() {
  await load(0)
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

  await load(0)
}

watchDebounced(effectiveQuery, async () => {
  await load(0)
}, { debounce: SEARCH_DEBOUNCE_MS })

onMounted(async () => {
  await Promise.all([load(0), loadSyncStatus()])
})
</script>
