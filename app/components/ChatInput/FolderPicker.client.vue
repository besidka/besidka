<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal modal-bottom sm:modal-middle"
    >
      <div class="modal-box max-w-2xl">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="font-bold text-lg">
              Choose folder
            </h3>
            <p class="text-sm opacity-60 mt-1">
              Start the next chat inside a folder.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="openCreateModal"
          >
            <Icon name="lucide:folder-plus" size="14" />
            New folder
          </button>
        </div>

        <UiSearchInput
          ref="searchInputRef"
          v-model="search"
          :is-searching="isLoadingFolders"
          placeholder="Search folders..."
          :show-keyboard-hint="false"
          class="mb-4"
        />

        <div class="rounded-box border border-base-200 max-h-80 overflow-y-auto p-2">
          <div
            v-if="isLoadingFolders"
            class="flex items-center justify-center py-8"
          >
            <span class="loading loading-spinner loading-md" />
          </div>

          <template v-else>
            <ul class="menu menu-sm w-full gap-1">
              <li>
                <h4 class="menu-title px-2">Actions</h4>
                <button
                  type="button"
                  :class="{ 'menu-active': !selectedFolderId }"
                  @click="onSelect(null, null)"
                >
                  <Icon
                    :name="selectedFolderId
                      ? 'lucide:x-circle'
                      : 'lucide:check'"
                    size="14"
                  />
                  No folder
                </button>
              </li>

              <li v-if="visiblePinnedFolders.length > 0">
                <h4 class="menu-title px-2">Pinned folders</h4>
                <button
                  v-for="folder in visiblePinnedFolders"
                  :key="folder.id"
                  type="button"
                  :class="{
                    'menu-active': folder.id === selectedFolderId,
                  }"
                  @click="onSelect(folder.id, folder.name)"
                >
                  <Icon
                    :name="folder.id === selectedFolderId
                      ? 'lucide:check'
                      : 'lucide:folder'"
                    size="14"
                  />
                  <span class="flex-1 text-left">{{ folder.name }}</span>
                  <Icon name="lucide:pin" size="12" class="opacity-50" />
                </button>
              </li>

              <li v-if="visibleFolders.length > 0">
                <h4 class="menu-title px-2">All folders</h4>
                <button
                  v-for="folder in visibleFolders"
                  :key="folder.id"
                  type="button"
                  :class="{
                    'menu-active': folder.id === selectedFolderId,
                  }"
                  @click="onSelect(folder.id, folder.name)"
                >
                  <Icon
                    :name="folder.id === selectedFolderId
                      ? 'lucide:check'
                      : 'lucide:folder'"
                    size="14"
                  />
                  {{ folder.name }}
                </button>
              </li>
            </ul>

            <div
              v-if="!hasVisibleFolders"
              class="px-4 py-8 text-center"
            >
              <Icon
                name="lucide:folder-search"
                size="36"
                class="mx-auto mb-3 opacity-40"
              />
              <p class="font-medium">
                {{
                  search.length
                    ? 'No folders match your search'
                    : 'No folders yet'
                }}
              </p>
              <p class="mt-2 text-sm opacity-60">
                {{ search.length
                  ? 'Try a different folder name.'
                  : 'Create a folder to organize chats.' }}
              </p>
            </div>
          </template>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="close"
          >
            Cancel
          </button>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @submit.prevent="close"
      >
        <button
          type="button"
          @click="close"
        >
          close
        </button>
      </form>
    </dialog>
  </Teleport>

  <HistoryFolderNameModal
    ref="folderNameModalRef"
    :is-submitting="isFolderModalSubmitting"
    @submit="onFolderModalSubmit"
  />
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { Folder } from '#shared/types/folders.d'

const emit = defineEmits<{
  submit: [payload: {
    folderId: string | null
    folderName: string | null
  }]
}>()

interface FolderNameModalInstance {
  openCreate: () => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const nuxtApp = useNuxtApp()
const dialogRef = shallowRef<HTMLDialogElement | null>(null)
const folderNameModalRef = shallowRef<FolderNameModalInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const search = shallowRef<string>('')
const allFolders = ref<Folder[]>([])
const isLoadingFolders = shallowRef<boolean>(false)
const selectedFolderId = shallowRef<string | null>(null)
const isFolderModalSubmitting = shallowRef<boolean>(false)

const searchedFolders = computed(() => {
  if (!search.value.length) {
    return allFolders.value
  }

  const query = search.value.toLowerCase()

  return allFolders.value.filter((folder) => {
    return folder.name.toLowerCase().includes(query)
  })
})

const visiblePinnedFolders = computed(() => {
  return searchedFolders.value.filter(folder => !!folder.pinnedAt)
})

const visibleFolders = computed(() => {
  return searchedFolders.value.filter(folder => !folder.pinnedAt)
})

const hasVisibleFolders = computed(() => {
  return visiblePinnedFolders.value.length > 0
    || visibleFolders.value.length > 0
})

async function loadFolders() {
  isLoadingFolders.value = true

  try {
    const response = await $fetch('/api/v1/folders')

    allFolders.value = [...response.pinned, ...response.folders]
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to load folders',
        parsedException.why,
      )
    })
  } finally {
    isLoadingFolders.value = false
  }
}

async function open(folderId: string | null) {
  selectedFolderId.value = folderId
  search.value = ''
  dialogRef.value?.showModal()
  await loadFolders()
  await nextTick()
  searchInputRef.value?.inputRef?.focus()
}

function close() {
  dialogRef.value?.close()
  search.value = ''
}

function onSelect(folderId: string | null, folderName: string | null) {
  selectedFolderId.value = folderId
  emit('submit', { folderId, folderName })
  close()
}

function openCreateModal() {
  folderNameModalRef.value?.openCreate()
}

async function onFolderModalSubmit(payload: {
  mode: 'create' | 'rename'
  name: string
}) {
  if (payload.mode !== 'create') {
    return
  }

  isFolderModalSubmitting.value = true
  isLoadingFolders.value = true

  try {
    const result = await $fetch('/api/v1/folders', {
      method: 'PUT',
      body: { name: payload.name },
    })

    const folder = result as Folder

    allFolders.value = [folder, ...allFolders.value]
    folderNameModalRef.value?.close()
    onSelect(folder.id, folder.name)
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to create folder',
        parsedException.why,
      )
    })
  } finally {
    isFolderModalSubmitting.value = false
    isLoadingFolders.value = false
  }
}

defineExpose({
  open,
  close,
})
</script>
