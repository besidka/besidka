<template>
  <HistoryPageShell active-tab="folders">
    <template #title>
      <h1 class="text-4xl font-bold text-center">
        Folders
      </h1>
    </template>
    <template #subtitle>
      <h2 class="mt-2 text-center">
        Organize your chats and keep conversations easy to find
      </h2>
    </template>

    <template #toolbar>
      <div class="flex flex-wrap items-center gap-2 shrink-0">
        <UiSearchInput
          ref="searchInputRef"
          v-model="search"
          :is-searching="isSearching"
          placeholder="Search folders..."
          class="flex-1 grow-2 shrink-0 min-w-48"
        />
        <div class="flex gap-2 grow">
          <select
            v-model="sortBy"
            class="select select-bordered min-w-28 grow"
          >
            <option value="activity">
              Recent
            </option>
            <option value="name">
              Name
            </option>
          </select>
          <button
            type="button"
            class="btn btn-primary max-sm:grow shrink-0 "
            :disabled="isCreating"
            @click="openCreateModal"
          >
            <span
              v-if="isCreating"
              class="loading loading-spinner loading-xs"
            />
            <Icon v-else name="lucide:folder-plus" size="14" />
            New folder
          </button>
        </div>
      </div>
    </template>

    <template #secondary-tabs>
      <div
        role="tablist"
        class="tabs tabs-box tabs-sm shrink-0"
      >
        <button
          role="tab"
          class="tab w-1/2"
          :class="{ 'tab-active': !showArchived }"
          @click="showArchived = false"
        >
          <Icon
            name="lucide:folder-check"
            size="14"
            class="mr-2"
          />
          Active
        </button>
        <button
          role="tab"
          class="tab w-1/2"
          :class="{ 'tab-active': showArchived }"
          @click="showArchived = true"
        >
          <Icon
            name="lucide:archive"
            size="14"
            class="mr-2"
          />
          Archived
        </button>
      </div>
    </template>

    <div
      v-if="isLoadingInitial && !hasCachedData"
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="rounded-box border border-base-200/70 p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="skeleton skeleton--default size-10 rounded-2xl shrink-0" />
            <div class="flex-1 space-y-2">
              <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
              <div class="skeleton skeleton--default h-3 w-1/3 rounded-full" />
            </div>
          </div>
          <div class="skeleton skeleton--default h-9 w-9 rounded-full shrink-0" />
        </div>
      </div>
    </div>

    <template v-else>
      <template v-if="pinned.length > 0">
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
            Pinned
          </span>
          <div class="flex-1 h-px bg-base-300" />
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="folder in pinned"
            :key="folder.id"
            class="card bg-base-100 cursor-pointer transition-colors hover:bg-base-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-content/20"
            role="link"
            tabindex="0"
            :aria-label="`Open folder ${folder.name}`"
            @click="openFolder(folder.id)"
            @keydown.enter.prevent="openFolder(folder.id)"
            @keydown.space.prevent="openFolder(folder.id)"
          >
            <div class="card-body p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex flex-1 items-center gap-2 min-w-0">
                  <Icon
                    name="lucide:folder-open"
                    size="18"
                    class="shrink-0"
                  />
                  <span class="font-medium truncate">{{ folder.name }}</span>
                </div>
                <div class="shrink-0">
                  <HistoryFolderActionsDropdown
                    :folder="folder"
                    @pin="togglePin(folder.id)"
                    @rename="openRenameModal(folder)"
                    @archive="toggleArchive(folder.id)"
                    @delete="onDeleteFolder(folder.id)"
                  />
                </div>
              </div>
              <div class="text-xs opacity-50">
                {{ formatActivityAge(new Date(folder.activityAt)) }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="folders.length > 0">
        <div
          v-if="pinned.length > 0"
          class="flex items-center gap-2"
        >
          <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
            All folders
          </span>
          <div class="flex-1 h-px bg-base-300" />
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="folder in folders"
            :key="folder.id"
            class="card bg-base-100 cursor-pointer transition-colors hover:bg-base-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-content/20"
            role="link"
            tabindex="0"
            :aria-label="`Open folder ${folder.name}`"
            @click="openFolder(folder.id)"
            @keydown.enter.prevent="openFolder(folder.id)"
            @keydown.space.prevent="openFolder(folder.id)"
          >
            <div class="card-body p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex flex-1 items-center gap-2 min-w-0">
                  <Icon
                    name="lucide:folder"
                    size="18"
                    class="shrink-0"
                  />
                  <span class="font-medium truncate">{{ folder.name }}</span>
                </div>
                <div class="shrink-0">
                  <HistoryFolderActionsDropdown
                    :folder="folder"
                    @pin="togglePin(folder.id)"
                    @rename="openRenameModal(folder)"
                    @archive="toggleArchive(folder.id)"
                    @delete="onDeleteFolder(folder.id)"
                  />
                </div>
              </div>
              <div class="text-xs opacity-50">
                {{ formatActivityAge(new Date(folder.activityAt)) }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="folders.length === 0 && pinned.length === 0 && !isLoadingInitial"
        class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      >
        <template v-if="search.length >= 2">
          <Icon name="lucide:search-x" size="40" class="mx-auto mb-3 opacity-60" />
          <p class="font-medium">No folders match your search</p>
          <p class="mt-2 text-sm opacity-60">
            Try a different folder name.
          </p>
        </template>
        <template v-else-if="showArchived">
          <Icon name="lucide:archive" size="40" class="mx-auto mb-3 opacity-60" />
          <p class="font-medium">No archived folders</p>
          <p class="mt-2 text-sm opacity-60">
            Archived folders will show up here.
          </p>
        </template>
        <template v-else>
          <Icon
            name="lucide:folder-open"
            size="40"
            class="mx-auto mb-3 opacity-60"
          />
          <p class="font-medium">Create your first folder to organize chats</p>
          <p class="mt-2 mb-4 text-sm opacity-60">
            Keep related conversations together and easier to revisit.
          </p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="openCreateModal"
          >
            Create folder
          </button>
        </template>
      </div>
    </template>
  </HistoryPageShell>

  <HistoryFolderNameModal
    ref="folderNameModalRef"
    :is-submitting="isFolderModalSubmitting"
    @submit="onFolderModalSubmit"
  />
</template>

<script setup lang="ts">
import type { Folder } from '#shared/types/folders.d'
import { formatActivityAge } from '#shared/utils/date-groups'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Folders',
})

const {
  folders,
  pinned,
  search,
  sortBy,
  showArchived,
  isLoadingInitial,
  isSearching,
  isCreating,
  hasCachedData,
  prime,
  hydrateAndRefresh,
  createFolder,
  renameFolder,
  togglePin,
  toggleArchive,
  deleteFolder,
} = useFolders()

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch('/api/v1/folders')

  prime(response)
}

interface FolderNameModalInstance {
  openCreate: () => void
  openRename: (folder: Folder) => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const folderNameModalRef = shallowRef<FolderNameModalInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const isFolderModalSubmitting = shallowRef<boolean>(false)

onMounted(() => {
  hydrateAndRefresh()
  document.addEventListener('keydown', onSearchKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onSearchKeydown)
})

function openFolder(folderId: string) {
  navigateTo(`/chats/folders/${folderId}`)
}

function openCreateModal() {
  folderNameModalRef.value?.openCreate()
}

function openRenameModal(folder: Folder) {
  folderNameModalRef.value?.openRename(folder)
}

async function onFolderModalSubmit(payload: {
  mode: 'create' | 'rename'
  folderId?: string
  name: string
}) {
  isFolderModalSubmitting.value = true

  try {
    if (payload.mode === 'create') {
      const folder = await createFolder(payload.name)

      if (folder) {
        folderNameModalRef.value?.close()
      }

      return
    }

    if (!payload.folderId) {
      return
    }

    await renameFolder(payload.folderId, payload.name)
    folderNameModalRef.value?.close()
  } finally {
    isFolderModalSubmitting.value = false
  }
}

async function onDeleteFolder(folderId: string) {
  const result = await useConfirm({
    text: 'Delete this folder? Chats inside will not be deleted.',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  await deleteFolder(folderId)
}

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

  if (event.key === 'Escape' && search.value) {
    search.value = ''
  }
}
</script>
