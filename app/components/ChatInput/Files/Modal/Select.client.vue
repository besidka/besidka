<template>
  <div class="flex flex-col h-full min-h-[300px]">
    <!-- Header with search and view switcher -->
    <div class="shrink-0 flex items-center gap-3 mb-3">
      <ChatInputFilesModalSelectSearchInput
        ref="searchInputRef"
        v-model="search"
        :is-searching="isSearching"
      />
      <ChatInputFilesModalSelectViewModeSwitcher
        v-model="viewMode"
      />
    </div>

    <!-- Scrollable Files Area -->
    <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
      <LazyChatInputFilesModalSelectGridSkeleton
        v-if="isLoading && !files.length && viewMode === 'grid'"
      />
      <LazyChatInputFilesModalSelectListSkeleton
        v-else-if="isLoading && !files.length && viewMode === 'list'"
      />

      <!-- Empty State -->
      <div
        v-else-if="!isLoading && !files.length"
        class="h-full flex flex-col items-center justify-center text-center p-8"
      >
        <Icon
          name="lucide:file-x"
          size="48"
          class="text-base-content/30 mb-3"
        />
        <h4 class="text-lg font-medium mb-2">
          {{ search ? 'No files found' : 'No files uploaded yet' }}
        </h4>
        <p class="text-base-content/60 text-sm">
          {{
            search
              ? 'Try a different search term'
              : 'Upload some files to get started'
          }}
        </p>
      </div>

      <template v-else>
        <KeepAlive>
          <LazyChatInputFilesModalSelectGridView
            v-if="viewMode === 'grid'"
            ref="gridViewRef"
            :files="files"
            :selected-ids="selectedIds"
            :is-touch-selecting="isTouchSelecting"
            :touched-indices="touchedIndices"
            @file-click="onFileClick"
            @rename="openRenameModal"
            @delete="confirmDelete"
          />
          <LazyChatInputFilesModalSelectListView
            v-else
            ref="listViewRef"
            :files="files"
            :selected-ids="selectedIds"
            :is-touch-selecting="isTouchSelecting"
            :touched-indices="touchedIndices"
            :all-selected="allSelected"
            :has-selection="hasSelection"
            @file-click="onFileClick"
            @rename="openRenameModal"
            @delete="confirmDelete"
            @toggle-select-all="handleToggleSelectAll"
          />
        </KeepAlive>
      </template>

      <!-- Load More -->
      <div
        v-if="hasMore"
        class="flex flex-col items-center gap-1 mt-3"
      >
        <span class="text-xs text-base-content/60">
          {{ files.length }} / {{ pagination.total }}
        </span>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isLoading"
          @click="loadMore"
        >
          <span
            v-if="isLoading"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>Load more</span>
        </button>
      </div>
    </div>

    <!-- Sticky Bulk Actions Bar -->
    <ChatInputFilesModalSelectActionsToolbar
      :selected-count="selectedCount"
      :max-files="maxFilesPerMessage"
      :visible="hasSelection"
      :is-deleting="isDeletingSelected"
      @deselect="handleDeselectAll"
      @delete="confirmDeleteSelected"
      @attach="attachSelected"
    />

    <!-- Rename Modal -->
    <ChatInputFilesModalSelectRenameModal
      ref="renameModalRef"
      @submit="handleRenameSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import type { FileManagerFile } from '~/types/file-manager'

const props = defineProps<{
  attachedIds: Set<string>
}>()

const emit = defineEmits<{
  attach: [files: FileManagerFile[]]
  detach: [fileIds: string[]]
  deleted: []
}>()

const nuxtApp = useNuxtApp()
const maxFilesPerMessage = shallowRef<number>(
  useRuntimeConfig().public.maxFilesPerMessage,
)
const { data: filePolicyResponse } = useLazyFetch(
  '/api/v1/files/policy',
  {
    server: false,
  },
)

const {
  files,
  selectedIds,
  isLoading,
  isSearching,
  isDeletingSelected,
  search,
  viewMode,
  pagination,
  hasMore,
  selectedCount,
  hasSelection,
  allSelected,
  fetchFiles,
  loadMore,
  selectRange,
  handleSelect,
  toggleSelectAll,
  deselectAll,
  renameFile,
  deleteFile,
  deleteSelected,
  getSelectedForAttach,
  reset,
} = useFileManager()

const gridViewRef = shallowRef<{
  containerRef: HTMLDivElement | null
} | null>(null)
const listViewRef = shallowRef<{
  containerRef: HTMLTableElement | null
} | null>(null)

const searchInputRef = shallowRef<{ inputRef: HTMLInputElement } | null>(null)
const activeElement = useActiveElement()

const isTouchSelecting = shallowRef<boolean>(false)
const touchStartIndex = shallowRef<number | null>(null)
const touchedIndices = ref<Set<number>>(new Set())
const touchSwipeHandled = shallowRef<boolean>(false)
const autoSelectedIds = ref<Set<string>>(new Set())
const isComponentActive = shallowRef<boolean>(false)

function getFileIndexFromElement(element: Element | null): number | null {
  if (!element) return null
  const fileElement = element.closest('[data-file-index]')
  if (!fileElement) return null
  const index = fileElement.getAttribute('data-file-index')

  return index !== null ? parseInt(index, 10) : null
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return

  const element = document.elementFromPoint(touch.clientX, touch.clientY)
  const index = getFileIndexFromElement(element)

  if (index !== null) {
    isTouchSelecting.value = true
    touchStartIndex.value = index
    touchedIndices.value = new Set([index])
  }
}

function handleTouchMove(event: TouchEvent) {
  if (!isTouchSelecting.value || touchStartIndex.value === null) return

  const touch = event.touches[0]
  if (!touch) return

  const element = document.elementFromPoint(touch.clientX, touch.clientY)
  const index = getFileIndexFromElement(element)

  if (index !== null && !touchedIndices.value.has(index)) {
    touchedIndices.value.add(index)
    event.preventDefault()
  }
}

function handleTouchEnd() {
  if (!isTouchSelecting.value) return

  if (touchedIndices.value.size > 1) {
    const indices = Array.from(touchedIndices.value).sort((a, b) => a - b)
    const startIndex = indices[0]!
    const endIndex = indices[indices.length - 1]!

    selectRange(startIndex, endIndex)

    touchSwipeHandled.value = true
    setTimeout(() => {
      touchSwipeHandled.value = false
    }, 100)
  }

  isTouchSelecting.value = false
  touchStartIndex.value = null
  touchedIndices.value = new Set()
}

function attachTouchListeners(element: HTMLElement | null) {
  if (!element) return

  element.addEventListener('touchstart', handleTouchStart, { passive: true })
  element.addEventListener('touchmove', handleTouchMove, { passive: false })
  element.addEventListener('touchend', handleTouchEnd)
}

function detachTouchListeners(element: HTMLElement | null) {
  if (!element) return

  element.removeEventListener('touchstart', handleTouchStart)
  element.removeEventListener('touchmove', handleTouchMove)
  element.removeEventListener('touchend', handleTouchEnd)
}

function getViewContainers() {
  const gridContainer = gridViewRef.value?.containerRef ?? null
  const listContainer = listViewRef.value?.containerRef ?? null

  return {
    gridContainer,
    listContainer,
  }
}

function attachInteractionListeners() {
  if (!isComponentActive.value) {
    return
  }

  document.removeEventListener('keydown', onSearchShortcut)
  document.addEventListener('keydown', onSearchShortcut)

  const { gridContainer, listContainer } = getViewContainers()

  detachTouchListeners(gridContainer)
  detachTouchListeners(listContainer)
  attachTouchListeners(gridContainer)
  attachTouchListeners(listContainer)
}

function detachInteractionListeners() {
  document.removeEventListener('keydown', onSearchShortcut)

  const { gridContainer, listContainer } = getViewContainers()

  detachTouchListeners(gridContainer)
  detachTouchListeners(listContainer)
}

async function rebindInteractionListeners() {
  if (!isComponentActive.value) {
    return
  }

  await nextTick()
  attachInteractionListeners()
}

watch(viewMode, async (_, __, onCleanup) => {
  await rebindInteractionListeners()

  onCleanup(() => {
    detachInteractionListeners()
  })
}, { flush: 'post' })

function onSearchShortcut(event: KeyboardEvent) {
  if (event.key !== '/') return

  const tagName = activeElement.value?.tagName
  const isEditable = activeElement.value?.hasAttribute?.('contenteditable')

  if (
    (tagName === 'INPUT' && !['radio', 'checkbox'].includes((activeElement.value as HTMLInputElement).type))
    || tagName === 'TEXTAREA'
    || isEditable
  ) {
    return
  }

  event.preventDefault()
  searchInputRef.value?.inputRef?.focus()
}

function onFileClick(
  event: MouseEvent,
  file: FileManagerFile,
  index: number,
) {
  if (touchSwipeHandled.value) {
    return
  }

  const isCurrentlySelected = selectedIds.value.has(file.id)
  const isAttached = props.attachedIds.has(file.id)
  const isShiftClick = event.shiftKey

  if (!isShiftClick && isCurrentlySelected && isAttached) {
    emit('detach', [file.id])
  }

  handleSelect(file.id, index, event.shiftKey)
}

const renameModalRef = shallowRef<{
  open: (file: FileManagerFile) => void
  close: () => void
} | null>(null)

function openRenameModal(file: FileManagerFile) {
  renameModalRef.value?.open(file)
}

async function handleRenameSubmit(fileId: string, newName: string) {
  const success = await renameFile(fileId, newName)

  if (success) {
    renameModalRef.value?.close()
  }
}

async function handleDelete(id: string) {
  const success = await deleteFile(id)

  if (success) {
    nuxtApp.callHook('files:deleted', [id])
    emit('deleted')
  }
}

async function handleDeleteSelected() {
  const idsToDelete = Array.from(selectedIds.value)
  const success = await deleteSelected()

  if (success) {
    nuxtApp.callHook('files:deleted', idsToDelete)
    emit('deleted')
  }
}

async function confirmDelete(file: FileManagerFile) {
  const result = await useConfirm({
    text: `Are you sure you want to delete "${truncateFilename(file.name, 30)}"?`,
    alert: true,
    actions: ['Confirm'],
  })

  if (!result) return

  await handleDelete(file.id)
}

async function confirmDeleteSelected() {
  const result = await useConfirm({
    text: `Are you sure you want to delete ${selectedCount.value} file${selectedCount.value === 1 ? '' : 's'}?`,
    alert: true,
    actions: ['Confirm'],
  })

  if (!result) return

  await handleDeleteSelected()
}

function attachSelected() {
  const selected = getSelectedForAttach()

  emit('attach', selected)
}

function handleDeselectAll() {
  const attachedSelectedIds = Array.from(selectedIds.value).filter((id) => {
    return props.attachedIds.has(id)
  })

  if (attachedSelectedIds.length > 0) {
    emit('detach', attachedSelectedIds)
  }

  deselectAll()
}

function handleToggleSelectAll() {
  if (allSelected.value) {
    const attachedSelectedIds = Array.from(selectedIds.value).filter((id) => {
      return props.attachedIds.has(id)
    })

    if (attachedSelectedIds.length > 0) {
      emit('detach', attachedSelectedIds)
    }
  }

  toggleSelectAll()
}

function syncAttachedSelection() {
  let changed: boolean = false

  for (const id of autoSelectedIds.value) {
    if (!props.attachedIds.has(id) && selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
      autoSelectedIds.value.delete(id)
      changed = true
    }
  }

  for (const file of files.value) {
    const fileId = file.id

    if (!fileId) {
      continue
    }

    if (props.attachedIds.has(fileId) && !selectedIds.value.has(fileId)) {
      selectedIds.value.add(fileId)
      autoSelectedIds.value.add(fileId)
      changed = true
    }
  }

  if (changed) {
    selectedIds.value = new Set(selectedIds.value)
    autoSelectedIds.value = new Set(autoSelectedIds.value)
  }
}

watch(files, async () => {
  syncAttachedSelection()
  await rebindInteractionListeners()
}, { flush: 'post' })
watch(() => props.attachedIds, syncAttachedSelection, { flush: 'post' })
watch(() => filePolicyResponse.value, (response) => {
  if (!response) {
    return
  }

  maxFilesPerMessage.value = response.policy.maxFilesPerMessage
}, {
  immediate: true,
  flush: 'post',
})

nuxtApp.hook('files:uploaded', () => fetchFiles(true))

onMounted(async () => {
  isComponentActive.value = true
  await fetchFiles(true)

  syncAttachedSelection()
  await rebindInteractionListeners()
})

onActivated(async () => {
  isComponentActive.value = true
  await rebindInteractionListeners()
})

onDeactivated(() => {
  isComponentActive.value = false
  detachInteractionListeners()
})

onUnmounted(() => {
  isComponentActive.value = false
  detachInteractionListeners()
  reset()
})

defineExpose({
  reset,
  fetchFiles,
})
</script>
