<template>
  <HistoryPageShell active-tab="folders">
    <template #title>
      <h1 class="text-4xl font-bold text-center">
        {{ folder?.name || 'Folder' }}
      </h1>
    </template>
    <template #subtitle>
      <div
        v-if="folder?.pinnedAt || folder?.archivedAt"
        class="mt-2 flex justify-center gap-2"
      >
        <span v-if="folder?.pinnedAt" class="badge badge-ghost badge-sm">
          Pinned
        </span>
        <span v-if="folder?.archivedAt" class="badge badge-ghost badge-sm">
          Archived
        </span>
      </div>
    </template>

    <template #toolbar>
      <div class="join flex justify-end">
        <NuxtLink
          :to="newChatInFolderUrl"
          class="btn btn-primary btn-sm join-item"
        >
          <Icon name="lucide:plus" size="14" />
          New chat in folder
        </NuxtLink>
        <HistoryFolderActionsDropdown
          v-if="folder"
          :folder="folder"
          @pin="onToggleFolderPin"
          @rename="openRenameModal"
          @archive="onToggleFolderArchive"
          @delete="onDeleteFolder"
        >
          <button
            type="button"
            class="btn btn-primary btn-sm btn-circle join-item"
            aria-label="Folder actions"
          >
            <Icon name="lucide:ellipsis" size="16" />
          </button>
        </HistoryFolderActionsDropdown>
      </div>
    </template>

    <HistoryChatSections
      :pinned="pinned"
      :chats="chats"
      :grouped-at="groupedAt"
      :is-loading-initial="isLoadingInitial && !hasCachedData"
      :is-selection-mode="false"
      :empty-state-mode="'folder'"
      :empty-action-to="newChatInFolderUrl"
      empty-action-label="New chat"
      @pin="onPin"
      @rename="openRenameChatModal"
      @delete="onDeleteChat"
      @add-to-folder="openFolderPicker"
      @remove-from-folder="onRemoveFromFolder"
    />

    <div
      v-if="hasMore"
      ref="infiniteScrollRef"
      class="flex justify-center py-4"
    >
      <span
        v-if="isLoadingMore"
        class="loading loading-spinner loading-sm"
      />
    </div>
  </HistoryPageShell>

  <HistoryRenameModal
    ref="renameModalRef"
    @submit="onRenameChatSubmit"
  />

  <HistoryFolderNameModal
    ref="folderNameModalRef"
    :is-submitting="isFolderModalSubmitting"
    @submit="onFolderModalSubmit"
  />

  <LazyHistoryFolderPicker
    ref="folderPickerRef"
    @submit="onFolderPickerSubmit"
  />
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { Folder } from '#shared/types/folders.d'
import type { HistoryChat } from '#shared/types/history.d'

definePageMeta({
  auth: {
    only: 'user',
  },
})

const route = useRoute()
const nuxtApp = useNuxtApp()
const folderId = computed(() => route.params.id as string)
const groupedAt = useState<string>('folder-chats:grouped-at', () => {
  return new Date().toISOString()
})

const {
  folder,
  pinned,
  chats,
  hasMore,
  hasCachedData,
  isLoadingInitial,
  isLoadingMore,
  prime,
  hydrateAndRefresh,
  loadMore,
  removeChat,
  renameChat,
  moveChat,
  togglePin,
  updateFolder,
} = useFolderChats(folderId)

if (import.meta.client && !nuxtApp.isHydrating) {
  groupedAt.value = new Date().toISOString()
}

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch(`/api/v1/folders/${folderId.value}/chats`)

  prime(response)
}

useSeoMeta({
  title: () => folder.value?.name || 'Folder',
})

const infiniteScrollRef = shallowRef<HTMLElement | null>(null)

const newChatInFolderUrl = computed(() => {
  return `/chats/new?folderId=${folderId.value}`
})

interface RenameModalInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

interface FolderNameModalInstance {
  openRename: (folder: Folder) => void
  close: () => void
}

interface FolderPickerInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

const renameModalRef = shallowRef<RenameModalInstance | null>(null)
const folderNameModalRef = shallowRef<FolderNameModalInstance | null>(null)
const folderPickerRef = shallowRef<FolderPickerInstance | null>(null)
const isFolderModalSubmitting = shallowRef<boolean>(false)

onMounted(() => {
  hydrateAndRefresh()
})

watch(folderId, () => {
  groupedAt.value = new Date().toISOString()
})

useIntersectionObserver(
  infiniteScrollRef,
  ([entry]) => {
    if (entry?.isIntersecting && hasMore.value && !isLoadingMore.value) {
      loadMore()
    }
  },
  { threshold: 0.1 },
)

function openRenameChatModal(chat: HistoryChat) {
  renameModalRef.value?.open(chat)
}

function openRenameModal() {
  if (!folder.value) {
    return
  }

  folderNameModalRef.value?.openRename(folder.value)
}

function openFolderPicker(chat: HistoryChat) {
  folderPickerRef.value?.open(chat)
}

async function onRenameChatSubmit(chatId: string, slug: string, title: string) {
  try {
    await $fetch(`/api/v1/chats/${slug}/rename`, {
      method: 'PATCH',
      body: { title },
    })

    renameChat(chatId, title)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Chat renamed')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to rename chat',
        parsedException.why,
      )
    })
  }

  renameModalRef.value?.close()
}

async function onDeleteChat(chatId: string, slug: string) {
  const result = await useConfirm({
    text: 'Are you sure you want to delete this chat?',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  try {
    await $fetch(`/api/v1/chats/${slug}`, {
      method: 'DELETE',
    })

    removeChat(chatId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Chat deleted')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to delete chat',
        parsedException.why,
      )
    })
  }
}

async function onFolderPickerSubmit(payload: {
  chatId: string
  slug: string
  folderId: string | null
  folderName: string | null
}) {
  try {
    await $fetch(`/api/v1/chats/${payload.slug}/folder`, {
      method: 'PATCH',
      body: { folderId: payload.folderId },
    })

    moveChat(payload.chatId, payload.folderId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        payload.folderId ? 'Moved to folder' : 'Removed from folder',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to move chat',
        parsedException.why,
      )
    })
  }
}

async function onRemoveFromFolder(chatId: string, slug: string) {
  try {
    await $fetch(`/api/v1/chats/${slug}/folder`, {
      method: 'PATCH',
      body: { folderId: null },
    })

    removeChat(chatId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Removed from folder')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to remove from folder',
        parsedException.why,
      )
    })
  }
}

async function onPin(chatId: string) {
  try {
    const response = await $fetch('/api/v1/chats/history/pin', {
      method: 'POST',
      body: { chatId },
    })

    togglePin(chatId, response.pinnedAt)
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to toggle pin',
        parsedException.why,
      )
    })
  }
}

async function onFolderModalSubmit(payload: {
  mode: 'create' | 'rename'
  folderId?: string
  name: string
}) {
  if (payload.mode !== 'rename' || !payload.folderId || !folder.value) {
    return
  }

  isFolderModalSubmitting.value = true

  try {
    await $fetch(`/api/v1/folders/${payload.folderId}/name`, {
      method: 'PATCH',
      body: { name: payload.name },
    })

    updateFolder({
      ...folder.value,
      name: payload.name,
    })

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Folder renamed')
    })

    folderNameModalRef.value?.close()
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to rename folder',
        parsedException.why,
      )
    })
  } finally {
    isFolderModalSubmitting.value = false
  }
}

async function onToggleFolderPin() {
  if (!folder.value) {
    return
  }

  try {
    const response = await $fetch(`/api/v1/folders/${folder.value.id}/pin`, {
      method: 'POST',
    })

    updateFolder({
      ...folder.value,
      pinnedAt: response.pinnedAt,
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to toggle pin',
        parsedException.why,
      )
    })
  }
}

async function onToggleFolderArchive() {
  if (!folder.value) {
    return
  }

  try {
    const response = await $fetch(`/api/v1/folders/${folder.value.id}/archive`, {
      method: 'POST',
    })

    updateFolder({
      ...folder.value,
      archivedAt: response.archivedAt,
    })

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        response.archivedAt
          ? 'Folder archived'
          : 'Folder restored',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to archive folder',
        parsedException.why,
      )
    })
  }
}

async function onDeleteFolder() {
  if (!folder.value) {
    return
  }

  const result = await useConfirm({
    text: 'Delete this folder? Chats inside will not be deleted.',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) {
    return
  }

  try {
    await $fetch(`/api/v1/folders/${folder.value.id}`, {
      method: 'DELETE',
    })

    navigateTo('/chats/folders')
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to delete folder',
        parsedException.why,
      )
    })
  }
}
</script>
