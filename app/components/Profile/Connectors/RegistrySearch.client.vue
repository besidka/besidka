<template>
  <div
    class="grid gap-3"
    data-testid="connector-registry"
  >
    <form
      role="search"
      class="grid gap-1"
      @submit.prevent="search(0)"
    >
      <label
        for="connector-registry-query"
        class="text-sm font-medium"
      >
        Search the directory
      </label>
      <div class="join w-full">
        <input
          id="connector-registry-query"
          v-model="query"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :maxlength="REGISTRY_SEARCH_QUERY_MAX_LENGTH"
          placeholder="Name or what it does"
          class="input join-item w-full"
          :disabled="isAdding"
          data-testid="connector-registry-query"
        >
        <button
          type="submit"
          class="btn join-item min-h-11 sm:min-h-10"
          :disabled="isAdding || isSearching || !isQueryLongEnough"
          data-testid="connector-registry-submit"
        >
          Search
        </button>
      </div>
      <p class="text-xs text-base-content/70">
        From the Official MCP Registry. Not reviewed by Besidka.
      </p>
    </form>

    <p
      class="sr-only"
      aria-live="polite"
    >
      {{ liveMessage }}
    </p>

    <p
      v-if="errorText"
      class="text-sm text-error"
      role="alert"
      data-testid="connector-registry-error"
    >
      {{ errorText }}
    </p>
    <p
      v-else-if="isSyncing"
      class="text-sm text-base-content/70"
      data-testid="connector-registry-syncing"
    >
      The directory is still being copied. Try again later.
    </p>
    <p
      v-else-if="hasSearched && !items.length && !isSearching"
      class="text-sm text-base-content/70"
      data-testid="connector-registry-empty"
    >
      Nothing found. Try another word, or add the server by its address.
    </p>

    <ul
      v-if="items.length"
      class="list"
      data-testid="connector-registry-results"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="list-row items-start gap-3 px-0 py-3"
        data-testid="connector-registry-item"
      >
        <ProfileConnectorsAvatar :title="displayName(item)" />
        <div class="list-col-grow grid min-w-0 gap-1">
          <p class="break-words font-medium">
            {{ displayName(item) }}
          </p>
          <p class="break-all font-mono text-xs text-base-content/70">
            {{ hostOf(item.remoteUrl) }}
          </p>
          <p
            v-if="item.description"
            class="line-clamp-3 break-words text-sm text-base-content/80"
          >
            {{ item.description }}
          </p>
          <p
            v-if="item.authHint === 'header'"
            class="text-xs text-base-content/70"
          >
            Needs an API key or token
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm min-h-11 sm:min-h-8"
          :disabled="isAdding || isAdded(item)"
          :aria-label="`Add ${displayName(item)}`"
          data-testid="connector-registry-add"
          @click="emit('add', item)"
        >
          {{ isAdded(item) ? 'Added' : 'Add' }}
        </button>
      </li>
    </ul>

    <button
      v-if="nextCursor !== null"
      type="button"
      class="btn btn-ghost btn-sm justify-self-center"
      :disabled="isSearching"
      data-testid="connector-registry-more"
      @click="search(nextCursor)"
    >
      Show more
    </button>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  REGISTRY_SEARCH_QUERY_MIN_LENGTH,
} from '#shared/utils/connectors-policy'
import type { ConnectorDirectoryItem } from '#shared/types/connectors.d'

const props = withDefaults(defineProps<{
  addedPresetIds: ReadonlySet<string>
  isAdding?: boolean
}>(), {
  isAdding: false,
})

const emit = defineEmits<{
  add: [item: ConnectorDirectoryItem]
}>()

const query = shallowRef<string>('')
const items = shallowRef<ConnectorDirectoryItem[]>([])
const nextCursor = shallowRef<number | null>(null)
const isSearching = shallowRef<boolean>(false)
const isSyncing = shallowRef<boolean>(false)
const hasSearched = shallowRef<boolean>(false)
const errorText = shallowRef<string>('')
const liveMessage = shallowRef<string>('')

const isQueryLongEnough = computed<boolean>(() => {
  return query.value.trim().length >= REGISTRY_SEARCH_QUERY_MIN_LENGTH
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

function isAdded(item: ConnectorDirectoryItem): boolean {
  return !!item.presetId && props.addedPresetIds.has(item.presetId)
}

async function search(cursor: number) {
  if (!isQueryLongEnough.value) {
    return
  }

  isSearching.value = true
  errorText.value = ''

  try {
    const result = await $fetch('/api/v1/connectors/registry', {
      query: {
        q: query.value.trim(),
        ...(cursor > 0 ? { cursor } : {}),
      },
    })
    const found = result.items as ConnectorDirectoryItem[]

    items.value = cursor > 0 ? [...items.value, ...found] : found
    nextCursor.value = result.nextCursor
    isSyncing.value = result.syncing === true
    hasSearched.value = true
    liveMessage.value = `${items.value.length} results`
  } catch (exception) {
    const parsedException = parseError(exception)

    errorText.value = parsedException.message || 'The search failed'
  } finally {
    isSearching.value = false
  }
}
</script>
