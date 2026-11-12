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
    <div
      class="tabs tabs-box max-xs:tabs-xs xs:tabs-sm w-full shrink-0 mb-3 flex-nowrap overflow-x-auto no-scrollbar"
      role="tablist"
      aria-label="Filter files by source"
      data-testid="files-source-tabs"
    >
      <input
        v-for="tab in sourceTabs"
        :key="tab.id"
        type="radio"
        name="file_source_tabs"
        class="tab grow shrink-0 whitespace-nowrap min-h-11 sm:min-h-8"
        :aria-label="tab.label"
        :checked="isSourceTabActive(tab)"
        :data-testid="tab.testId"
        @change="selectSourceTab(tab)"
      >
    </div>
    <ChatInputFilesModalSelectKindFilter
      v-if="isKindFilterVisible"
      v-model="kind"
    />

    <!-- Scrollable Files Area -->
    <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
      <component
        :is="activeExtraTab.component"
        v-if="activeExtraTab"
        :attached-ids="attachedIds"
        :search="search"
        :view-mode="viewMode"
        @attach="onExtraSourceAttach"
      />
      <LazyChatInputFilesModalSelectGridSkeleton
        v-else-if="isInitialLoading && viewMode === 'grid'"
      />
      <LazyChatInputFilesModalSelectListSkeleton
        v-else-if="isInitialLoading && viewMode === 'list'"
      />

      <!-- Empty State -->
      <div
        v-else-if="isEmpty"
        class="h-full flex flex-col items-center justify-center text-center p-8"
      >
        <Icon
          :name="emptyStateIcon"
          size="48"
          class="text-base-content/30 mb-3"
        />
        <h4 class="text-lg font-medium mb-2 max-w-full break-words">
          {{ emptyStateTitle }}
        </h4>
        <p class="text-base-content/60 text-sm">
          {{ emptyStateDescription }}
        </p>
      </div>

      <ChatInputFilesModalSelectProjectGroups
        v-else-if="isProjectSource"
        ref="projectGroupsRef"
        :groups="projectGroups"
        :selected-ids="selectedIds"
        :view-mode="viewMode"
        :is-touch-selecting="isTouchSelecting"
        :touched-indices="touchedIndices"
        :touch-group-id="touchGroupId"
        :unsupported-reasons="unsupportedReasons"
        :unsupported-captions="unsupportedCaptions"
        @toggle="toggleProjectGroup"
        @load-more="loadMoreProjectGroup"
        @file-click="onFileClick"
        @preview="onPreview"
        @rename="openRenameModal"
        @delete="confirmDelete"
        @toggle-select-all="handleToggleProjectGroupSelectAll"
      />

      <template v-else>
        <KeepAlive>
          <LazyChatInputFilesModalSelectGridView
            v-if="viewMode === 'grid'"
            ref="gridViewRef"
            :files="files"
            :selected-ids="selectedIds"
            :is-touch-selecting="isTouchSelecting"
            :touched-indices="touchedIndices"
            :unsupported-reasons="unsupportedReasons"
            :unsupported-captions="unsupportedCaptions"
            @file-click="onFileClick"
            @preview="onPreview"
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
            :unsupported-reasons="unsupportedReasons"
            :unsupported-captions="unsupportedCaptions"
            @file-click="onFileClick"
            @preview="onPreview"
            @rename="openRenameModal"
            @delete="confirmDelete"
            @toggle-select-all="handleToggleSelectAll"
          />
        </KeepAlive>
      </template>

      <!-- Load More -->
      <div
        v-if="!activeExtraTab && !isProjectSource && hasMore"
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
      :visible="!activeExtraTab && hasSelection"
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
import type {
  ExtraFileSourceTab,
  FileManagerFile,
  FileSourceFilter,
  FileSourceTab,
} from '~/types/file-manager'
import type {
  FileDeliveryResolver,
  FileRejection,
} from '~/utils/file-delivery-hints'

const props = withDefaults(defineProps<{
  attachedIds: Set<string>
  initialSource?: FileSourceFilter
  canAttachMediaType?: (mediaType: string) => boolean
  resolveDelivery?: FileDeliveryResolver
}>(), {
  initialSource: undefined,
  canAttachMediaType: () => true,
  resolveDelivery: undefined,
})

const emit = defineEmits<{
  attach: [files: FileManagerFile[]]
  detach: [fileIds: string[]]
  deleted: []
  preview: [file: FileManagerFile]
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
  source,
  kind,
  viewMode,
  pagination,
  projectGroups,
  isProjectGroupsLoading,
  projectLoadedFiles,
  hasMore,
  loadedFiles,
  selectedCount,
  hasSelection,
  allSelected,
  fetchFiles,
  loadMore,
  toggleProjectGroup,
  loadMoreProjectGroup,
  selectRange,
  selectProjectGroupRange,
  handleSelect,
  handleProjectGroupSelect,
  toggleProjectGroupSelectAll,
  toggleSelectAll,
  deselectAll,
  renameFile,
  deleteFile,
  deleteSelected,
  getSelectedForAttach,
  reset: resetFileManager,
} = useFileManager()

const fileRejections = computed<Map<string, FileRejection>>(() => {
  const resolve = props.resolveDelivery
    ?? createPredicateDeliveryResolver(props.canAttachMediaType)
  const rejections = new Map<string, FileRejection>()

  for (const file of loadedFiles.value) {
    const rejection = getFileRejection(file, resolve)

    if (rejection) {
      rejections.set(file.id, rejection)
    }
  }

  return rejections
})

const unsupportedReasons = computed<Record<string, string>>(() => {
  const reasons: Record<string, string> = {}

  for (const [fileId, rejection] of fileRejections.value) {
    const [message] = getRejectionMessages(
      [rejection],
      props.canAttachMediaType,
    )

    reasons[fileId] = message || ''
  }

  return reasons
})

const unsupportedCaptions = computed<Record<string, string>>(() => {
  const captions: Record<string, string> = {}

  for (const [fileId, rejection] of fileRejections.value) {
    captions[fileId] = getRejectionCaption(rejection.reason)
  }

  return captions
})

const extraSourceTabs = getFileManagerExtraSourceTabs()
const activeExtraTabId = shallowRef<string | null>(null)

const sourceTabs = computed<FileSourceTab[]>(() => {
  return resolveFileManagerSourceTabs({
    extraTabs: extraSourceTabs,
  })
})

const activeExtraTab = computed<ExtraFileSourceTab | null>(() => {
  if (!activeExtraTabId.value) {
    return null
  }

  return sourceTabs.value.find((tab): tab is ExtraFileSourceTab => {
    return tab.kind === 'extra' && tab.id === activeExtraTabId.value
  }) ?? null
})

function isSourceTabActive(tab: FileSourceTab): boolean {
  if (tab.kind === 'extra') {
    return activeExtraTab.value?.id === tab.id
  }

  return !activeExtraTab.value && source.value === tab.id
}

function selectSourceTab(tab: FileSourceTab): void {
  if (tab.kind === 'extra') {
    activeExtraTabId.value = tab.id

    return
  }

  activeExtraTabId.value = null
  source.value = tab.id
}

watch(activeExtraTab, (tab) => {
  if (tab || !activeExtraTabId.value) {
    return
  }

  activeExtraTabId.value = null
})

function onExtraSourceAttach(attachedFiles: FileManagerFile[]): void {
  emit('attach', attachedFiles)
}

function reset(): void {
  activeExtraTabId.value = null
  resetFileManager()
}

watch(() => props.initialSource, (newSource) => {
  if (!newSource) {
    return
  }

  activeExtraTabId.value = null
  source.value = newSource
}, { immediate: true })

const isKindFilterVisible = computed<boolean>(() => {
  return !activeExtraTab.value && source.value === 'assistant'
})

const isProjectSource = computed<boolean>(() => source.value === 'project')

const isListLoading = computed<boolean>(() => {
  return isProjectSource.value ? isProjectGroupsLoading.value : isLoading.value
})

const hasNoVisibleFiles = computed<boolean>(() => {
  return isProjectSource.value
    ? projectGroups.value.length === 0
    : files.value.length === 0
})

const isInitialLoading = computed<boolean>(() => {
  return isListLoading.value && hasNoVisibleFiles.value
})

const isEmpty = computed<boolean>(() => {
  return !isListLoading.value && hasNoVisibleFiles.value
})

const emptyStateIcon = computed<string>(() => {
  if (source.value === 'assistant' && kind.value === 'document') {
    return 'lucide:file-text'
  }

  if (source.value === 'assistant') {
    return 'lucide:image-plus'
  }

  if (source.value === 'project') {
    return 'lucide:folder-open'
  }

  return 'lucide:upload'
})

const emptyStateTitle = computed<string>(() => {
  if (search.value && source.value === 'project') {
    return `No project files match "${search.value}"`
  }

  if (search.value) {
    return 'No files found'
  }

  if (source.value === 'assistant' && kind.value === 'image') {
    return 'No AI-generated images yet'
  }

  if (source.value === 'assistant' && kind.value === 'document') {
    return 'No AI-generated documents yet'
  }

  if (source.value === 'assistant') {
    return 'No AI-generated files yet'
  }

  if (source.value === 'project') {
    return 'No project files yet'
  }

  return 'No uploaded files yet'
})

const emptyStateDescription = computed<string>(() => {
  if (search.value) {
    return 'Try a different search term or file source'
  }

  if (source.value === 'assistant' && kind.value === 'image') {
    return 'Images created in chat will appear here'
  }

  if (source.value === 'assistant' && kind.value === 'document') {
    return 'Documents created in chat will appear here'
  }

  if (source.value === 'assistant') {
    return 'Images and documents created in chat will appear here'
  }

  if (source.value === 'project') {
    return 'Files added to project knowledge will appear here'
  }

  return 'Upload files to add them to your library'
})

const gridViewRef = shallowRef<{
  containerRef: HTMLDivElement | null
} | null>(null)
const listViewRef = shallowRef<{
  containerRef: HTMLTableElement | null
} | null>(null)

const projectGroupsRef = shallowRef<{
  containerRef: HTMLDivElement | null
} | null>(null)

const searchInputRef = shallowRef<{ inputRef: HTMLInputElement } | null>(null)
const activeElement = useActiveElement()

const isTouchSelecting = shallowRef<boolean>(false)
const touchStartIndex = shallowRef<number | null>(null)
const touchedIndices = ref<Set<number>>(new Set())
const touchGroupId = shallowRef<string | null>(null)
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

function getProjectGroupIdFromElement(element: Element | null): string | null {
  if (!element) return null

  const groupElement = element.closest('.js-project-group')

  return groupElement?.getAttribute('data-project-group-id') ?? null
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return

  const element = document.elementFromPoint(touch.clientX, touch.clientY)
  const index = getFileIndexFromElement(element)

  if (index !== null) {
    isTouchSelecting.value = true
    touchStartIndex.value = index
    touchGroupId.value = getProjectGroupIdFromElement(element)
    touchedIndices.value = new Set([index])
  }
}

function handleTouchMove(event: TouchEvent) {
  if (!isTouchSelecting.value || touchStartIndex.value === null) return

  const touch = event.touches[0]
  if (!touch) return

  const element = document.elementFromPoint(touch.clientX, touch.clientY)
  const index = getFileIndexFromElement(element)

  if (getProjectGroupIdFromElement(element) !== touchGroupId.value) return

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

    if (touchGroupId.value) {
      selectProjectGroupRange(touchGroupId.value, startIndex, endIndex)
    } else {
      selectRange(startIndex, endIndex)
    }

    touchSwipeHandled.value = true
    setTimeout(() => {
      touchSwipeHandled.value = false
    }, 100)
  }

  isTouchSelecting.value = false
  touchStartIndex.value = null
  touchGroupId.value = null
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

function getViewContainers(): HTMLElement[] {
  const containers: Array<HTMLElement | null | undefined> = [
    gridViewRef.value?.containerRef,
    listViewRef.value?.containerRef,
    projectGroupsRef.value?.containerRef,
  ]

  return containers.filter((container): container is HTMLElement => {
    return !!container
  })
}

function attachInteractionListeners() {
  if (!isComponentActive.value) {
    return
  }

  document.removeEventListener('keydown', onSearchShortcut)
  document.addEventListener('keydown', onSearchShortcut)

  for (const container of getViewContainers()) {
    detachTouchListeners(container)
    attachTouchListeners(container)
  }
}

function detachInteractionListeners() {
  document.removeEventListener('keydown', onSearchShortcut)

  for (const container of getViewContainers()) {
    detachTouchListeners(container)
  }
}

async function rebindInteractionListeners() {
  if (!isComponentActive.value) {
    return
  }

  await nextTick()
  attachInteractionListeners()
}

watch([viewMode, source, activeExtraTabId], async (_, __, onCleanup) => {
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
  groupId?: string,
) {
  if (touchSwipeHandled.value) {
    return
  }

  const unsupportedReason = unsupportedReasons.value[file.id]

  if (unsupportedReason) {
    useWarningMessage(unsupportedReason)

    return
  }

  const isCurrentlySelected = selectedIds.value.has(file.id)
  const isAttached = props.attachedIds.has(file.id)
  const isShiftClick = event.shiftKey

  if (!isShiftClick && isCurrentlySelected && isAttached) {
    emit('detach', [file.id])
  }

  if (groupId) {
    handleProjectGroupSelect(groupId, file.id, index, event.shiftKey)

    return
  }

  handleSelect(file.id, index, event.shiftKey)
}

function onPreview(file: FileManagerFile) {
  emit('preview', file)
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
  const attachable = selected.filter((file) => {
    return !unsupportedReasons.value[file.id]
  })
  const rejected = selected.filter((file) => {
    return unsupportedReasons.value[file.id]
  })

  if (rejected.length > 0) {
    const rejections = rejected.flatMap((file) => {
      return fileRejections.value.get(file.id) ?? []
    })

    for (const message of getRejectionMessages(
      rejections,
      props.canAttachMediaType,
    )) {
      useWarningMessage(message)
    }
  }

  if (attachable.length === 0) {
    return
  }

  emit('attach', attachable)
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

function handleToggleProjectGroupSelectAll(groupId: string) {
  const groupFiles = projectGroups.value.find((group) => {
    return group.id === groupId
  })?.files ?? []
  const isGroupAllSelected = groupFiles.length > 0
    && groupFiles.every(file => selectedIds.value.has(file.id))

  if (isGroupAllSelected) {
    const attachedGroupIds = groupFiles
      .map(file => file.id)
      .filter(id => props.attachedIds.has(id))

    if (attachedGroupIds.length > 0) {
      emit('detach', attachedGroupIds)
    }
  }

  toggleProjectGroupSelectAll(groupId)
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

  for (const file of loadedFiles.value) {
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

watch([files, projectLoadedFiles], async () => {
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
