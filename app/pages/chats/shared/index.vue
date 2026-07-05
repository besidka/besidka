<template>
  <HistoryPageShell active-tab="shared">
    <template #title>
      Shared
    </template>
    <template #subtitle>
      Chats you've shared with a public link
    </template>

    <HistoryActionsToolbar
      :selected-count="selectedCount"
      :visible="isSelectionMode"
      :is-deleting="false"
      :show-move-to-project="false"
      :show-delete="false"
      :show-cancel-sharing="true"
      @deselect="deselectAll"
      @cancel-sharing="onBulkCancelSharing"
    />

    <HistoryChatSections
      :pinned="[]"
      :chats="chats"
      :grouped-at="groupedAt"
      :is-loading-initial="isLoadingInitial && !hasCachedData"
      :is-selection-mode="isSelectionMode"
      :selected-ids="selectedIds"
      variant="shared"
      empty-state-mode="shared"
      empty-action-to="/chats/history"
      empty-action-label="View chats"
      @select="onToggleSelect"
      @enter-select="onEnterSelect"
      @cancel-sharing="onCancelSharing"
    />

    <div
      v-if="hasMore"
      ref="infiniteScrollRef"
      class="flex justify-center py-4"
    >
      <span
        v-if="isLoading"
        class="loading loading-spinner loading-sm"
      />
    </div>
  </HistoryPageShell>
</template>

<script setup lang="ts">
definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Shared Chats',
})

const nuxtApp = useNuxtApp()

const {
  chats,
  isLoading,
  isLoadingInitial,
  hasCachedData,
  hasMore,
  selectedIds,
  isSelectionMode,
  selectedCount,
  prime,
  hydrateAndRefresh,
  loadMore,
  handleSelect,
  enterSelectionMode,
  deselectAll,
  cancelSharing,
  cancelSharingSelected,
} = useSharedChats()

const groupedAt = useState<string>('shared-chats:grouped-at', () => {
  return new Date().toISOString()
})

if (import.meta.client && !nuxtApp.isHydrating) {
  groupedAt.value = new Date().toISOString()
}

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch('/api/v1/chats/shared')

  prime(response)
}

const infiniteScrollRef = shallowRef<HTMLElement | null>(null)

onMounted(() => {
  hydrateAndRefresh()
})

useIntersectionObserver(
  infiniteScrollRef,
  ([entry]) => {
    if (entry?.isIntersecting && hasMore.value && !isLoading.value) {
      loadMore()
    }
  },
  { threshold: 0.1 },
)

function onToggleSelect(chatId: string, index: number, shiftKey: boolean) {
  handleSelect(chatId, index, shiftKey)
}

function onEnterSelect(chatId: string, index: number) {
  enterSelectionMode(chatId, index)
}

async function onCancelSharing(chatId: string) {
  await cancelSharing(chatId)
}

async function onBulkCancelSharing() {
  const count = selectedCount.value
  const result = await useConfirm({
    text: `Cancel sharing for ${count} chat${count === 1 ? '' : 's'}?`,
    alert: true,
    actions: ['Cancel sharing'],
  })

  if (!result) return

  await cancelSharingSelected()
}
</script>
