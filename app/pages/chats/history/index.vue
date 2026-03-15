<template>
  <HistoryPageShell active-tab="chats">
    <template #title>
      History
    </template>
    <template #subtitle>
      View your chat history and revisit past conversations
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 shrink-0">
        <UiSearchInput
          ref="searchInputRef"
          v-model="search"
          :is-searching="isSearching"
          placeholder="Search chats..."
          class="flex-1"
        />
      </div>
    </template>

    <HistoryActionsToolbar
      :selected-count="selectedCount"
      :visible="isSelectionMode"
      :is-deleting="isDeletingSelected"
      @deselect="deselectAll"
      @delete="onBulkDelete"
      @move-to-project="onBulkMoveToProject"
    />

    <HistoryChatSections
      :pinned="pinned"
      :chats="chats"
      :grouped-at="groupedAt"
      :is-loading-initial="isLoadingInitial && !hasCachedData"
      :is-selection-mode="isSelectionMode"
      :selected-ids="selectedIds"
      :empty-state-mode="search.length >= 2 ? 'search' : 'history'"
      empty-action-to="/chats/new"
      empty-action-label="New chat"
      @pin="togglePin"
      @rename="openRenameModal"
      @delete="onDeleteChat"
      @select="onToggleSelect"
      @enter-select="onEnterSelect"
      @add-to-project="openProjectPicker"
      @remove-from-project="onRemoveFromProject"
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

  <HistoryRenameModal
    ref="renameModalRef"
    @submit="onRenameSubmit"
  />

  <LazyProjectsProjectPicker
    ref="projectPickerRef"
    @submit="onProjectPickerSubmit"
  />
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Chats History',
})

const nuxtApp = useNuxtApp()

const {
  chats,
  pinned,
  search,
  isLoading,
  isLoadingInitial,
  isSearching,
  hasCachedData,
  hasMore,
  selectedIds,
  isSelectionMode,
  selectedCount,
  prime,
  hydrateAndRefresh,
  loadMore,
  togglePin,
  handleSelect,
  enterSelectionMode,
  deselectAll,
  deleteSelected,
  renameChat,
  deleteChat,
  moveChatToProject,
  moveSelectedToProject,
} = useHistory()

const groupedAt = useState<string>('history:grouped-at', () => {
  return new Date().toISOString()
})

if (import.meta.client && !nuxtApp.isHydrating) {
  groupedAt.value = new Date().toISOString()
}

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch('/api/v1/chats/history')

  prime(response)
}

const isDeletingSelected = shallowRef<boolean>(false)

interface RenameModalInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

interface ProjectPickerInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const renameModalRef = shallowRef<RenameModalInstance | null>(null)
const projectPickerRef = shallowRef<ProjectPickerInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const infiniteScrollRef = shallowRef<HTMLElement | null>(null)

onMounted(() => {
  hydrateAndRefresh()
  document.addEventListener('keydown', onSearchKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onSearchKeydown)
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

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  const tagName = element?.tagName
  const isEditable = element?.hasAttribute?.('contenteditable')

  return (
    (tagName === 'INPUT'
      && !['radio', 'checkbox'].includes(
        (element as HTMLInputElement).type,
      ))
      || tagName === 'TEXTAREA'
      || isEditable
  )
}

function onSearchKeydown(event: KeyboardEvent) {
  if (document.querySelector('dialog[open]')) {
    return
  }

  if (event.key === '/') {
    if (isEditableTarget(event.target)) {
      return
    }

    event.preventDefault()
    searchInputRef.value?.inputRef?.focus()

    return
  }

  if (event.key !== 'Escape') {
    return
  }

  if (search.value) {
    search.value = ''

    return
  }

  if (isSelectionMode.value) {
    deselectAll()
  }
}

function onToggleSelect(chatId: string, index: number, shiftKey: boolean) {
  handleSelect(chatId, index, shiftKey)
}

function onEnterSelect(chatId: string, index: number) {
  enterSelectionMode(chatId, index)
}

function openRenameModal(chat: HistoryChat) {
  renameModalRef.value?.open(chat)
}

function openProjectPicker(chat: HistoryChat) {
  projectPickerRef.value?.open(chat)
}

async function onProjectPickerSubmit(payload: {
  chatId: string
  slug: string
  projectId: string | null
  projectName: string | null
}) {
  if (isSelectionMode.value && selectedIds.value.has(payload.chatId)) {
    await moveSelectedToProject(payload.projectId, payload.projectName)
  } else {
    await moveChatToProject(
      payload.chatId,
      payload.slug,
      payload.projectId,
      payload.projectName,
    )
  }
}

async function onRemoveFromProject(chatId: string, slug: string) {
  await moveChatToProject(chatId, slug, null, null)
}

async function onRenameSubmit(chatId: string, slug: string, title: string) {
  await renameChat(chatId, slug, title)
  renameModalRef.value?.close()
}

async function onDeleteChat(chatId: string, slug: string) {
  const result = await useConfirm({
    text: 'Are you sure you want to delete this chat?',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  await deleteChat(chatId, slug)
}

async function onBulkDelete() {
  const count = selectedCount.value
  const result = await useConfirm({
    text: `Are you sure you want to delete ${count} chat${count === 1 ? '' : 's'}?`,
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  isDeletingSelected.value = true

  try {
    await deleteSelected()
  } finally {
    isDeletingSelected.value = false
  }
}

function onBulkMoveToProject() {
  const firstSelected = [...selectedIds.value][0]

  if (!firstSelected) return

  const chat = chats.value.find(candidate => candidate.id === firstSelected)
    ?? pinned.value.find(candidate => candidate.id === firstSelected)

  if (!chat) return

  projectPickerRef.value?.open(chat)
}
</script>
