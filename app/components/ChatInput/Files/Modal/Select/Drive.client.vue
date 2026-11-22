<template>
  <div
    class="flex flex-col min-h-full"
    data-testid="files-drive-tab"
  >
    <LazyChatInputFilesModalSelectGridSkeleton
      v-if="connectionState === 'loading'"
    />

    <div
      v-else-if="connectionState !== 'connected'"
      class="flex-1 flex flex-col items-center justify-center text-center p-8"
      data-testid="files-drive-status"
      :data-state="connectionState"
    >
      <Icon
        :name="GOOGLE_DRIVE_ICON"
        size="48"
        class="text-base-content/30 mb-3"
      />
      <p class="text-base-content/80 text-sm max-w-sm mb-4">
        {{ statusSentence }}
      </p>
      <button
        v-if="connectionState === 'error'"
        type="button"
        class="btn btn-sm"
        data-testid="files-drive-retry"
        @click="refreshConnection()"
      >
        Try again
      </button>
      <button
        v-else
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="files-drive-connect"
        @click="openConnectionSettings"
      >
        {{
          connectionState === 'reauthorize'
            ? GOOGLE_DRIVE_TAB_RECONNECT_LABEL
            : GOOGLE_DRIVE_TAB_CONNECT_LABEL
        }}
      </button>
    </div>

    <template v-else>
      <div
        v-if="!isEmpty || search"
        class="shrink-0 flex flex-wrap items-center justify-between gap-2 mb-3"
      >
        <p class="text-base-content/60 text-xs">
          Copies of files you picked in Google Drive
        </p>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isBusy"
          data-testid="files-drive-pick"
          @click="pickMore"
        >
          <span
            v-if="isBusy"
            class="loading loading-spinner loading-xs"
          />
          <Icon v-else :name="GOOGLE_DRIVE_ICON" size="14" />
          {{ pickLabel }}
        </button>
      </div>

      <LazyChatInputFilesModalSelectGridSkeleton
        v-if="isInitialLoading && viewMode === 'grid'"
      />
      <LazyChatInputFilesModalSelectListSkeleton
        v-else-if="isInitialLoading"
      />

      <div
        v-else-if="isEmpty"
        class="flex-1 flex flex-col items-center justify-center text-center p-8"
        data-testid="files-drive-empty"
      >
        <Icon
          :name="GOOGLE_DRIVE_ICON"
          size="48"
          class="text-base-content/30 mb-3"
        />
        <h4 class="text-lg font-medium mb-2 max-w-full break-words">
          {{
            search
              ? 'No files found'
              : GOOGLE_DRIVE_TAB_EMPTY_TITLE
          }}
        </h4>
        <p class="text-base-content/60 text-sm mb-4">
          {{
            search
              ? 'Try a different search term'
              : GOOGLE_DRIVE_TAB_EMPTY_DESCRIPTION
          }}
        </p>
        <button
          v-if="!search"
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="isBusy"
          data-testid="files-drive-pick"
          @click="pickMore"
        >
          <span
            v-if="isBusy"
            class="loading loading-spinner loading-xs"
          />
          <Icon v-else :name="GOOGLE_DRIVE_ICON" size="14" />
          {{ pickLabel }}
        </button>
      </div>

      <template v-else>
        <LazyChatInputFilesModalSelectGridView
          v-if="viewMode === 'grid'"
          ref="gridViewRef"
          :files="files"
          :selected-ids="selectedIds"
          :is-touch-selecting="isTouchSelecting"
          :touched-indices="touchedIndices"
          :unsupported-reasons="unsupportedReasons"
          :unsupported-captions="unsupportedCaptions"
          :text-notes="textNotes"
          refreshable
          @file-click="onFileClick"
          @refresh="refreshOne"
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
          :text-notes="textNotes"
          refreshable
          @file-click="onFileClick"
          @refresh="refreshOne"
          @rename="openRenameModal"
          @delete="confirmDelete"
          @toggle-select-all="handleToggleSelectAll"
        />
      </template>

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
          data-testid="files-drive-load-more"
          @click="loadMore"
        >
          <span
            v-if="isLoading"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>Load more</span>
        </button>
      </div>

      <ChatInputFilesModalSelectActionsToolbar
        class="sticky bottom-0 z-10"
        :selected-count="selectedCount"
        :max-files="maxFilesPerMessage"
        :visible="hasSelection"
        :is-deleting="isDeletingSelected"
        :is-refreshing="isRefreshing"
        refreshable
        @deselect="handleDeselectAll"
        @delete="confirmDeleteSelected"
        @attach="attachSelected"
        @refresh="refreshSelected"
      />

      <ChatInputFilesModalSelectRenameModal
        ref="renameModalRef"
        @submit="handleRenameSubmit"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-drive'
import type {
  AttachedFile,
  FileManagerFile,
  ViewMode,
} from '~/types/file-manager'
import type {
  FileDeliveryHint,
  FileDeliveryResolver,
  FileRejection,
} from '~/utils/file-delivery-hints'

type ConnectionState = 'loading' | 'error' | 'not-connected' | 'reauthorize'
  | 'connected'

const props = withDefaults(defineProps<{
  attachedIds: Set<string>
  search?: string
  viewMode?: ViewMode
  canAttachMediaType?: (mediaType: string) => boolean
  resolveDelivery?: FileDeliveryResolver
}>(), {
  search: '',
  viewMode: 'grid',
  canAttachMediaType: () => true,
  resolveDelivery: undefined,
})

const emit = defineEmits<{
  attach: [files: FileManagerFile[]]
  detach: [fileIds: string[]]
  replace: [previousId: string, file: AttachedFile]
  changed: []
}>()

const nuxtApp = useNuxtApp()
const dialog = inject(FILE_MANAGER_DIALOG_KEY, noopFileManagerDialogControls)

const {
  data: connectionResponse,
  status: connectionFetchStatus,
  refresh: refreshConnection,
} = useGoogleConnection()

const {
  files,
  selectedIds,
  isLoading,
  isDeletingSelected,
  search: managerSearch,
  source,
  pagination,
  hasMore,
  loadedFiles,
  selectedCount,
  hasSelection,
  allSelected,
  fetchFiles,
  loadMore,
  handleSelect,
  selectRange,
  toggleSelectAll,
  deselectAll,
  renameFile,
  deleteFile,
  deleteSelected,
  getSelectedForAttach,
  reset: resetFileManager,
} = useFileManager()

source.value = 'google'

const {
  isTouchSelecting,
  touchedIndices,
  touchSwipeHandled,
  attachTouchListeners,
  detachTouchListeners,
} = useFileTouchSelect({ selectRange })

watch(() => props.search, (value) => {
  managerSearch.value = value
}, { immediate: true })

const maxFilesPerMessage = shallowRef<number>(
  useRuntimeConfig().public.maxFilesPerMessage,
)
const { data: filePolicyResponse } = useLazyFetch('/api/v1/files/policy', {
  server: false,
})

watch(() => filePolicyResponse.value, (response) => {
  if (!response) {
    return
  }

  maxFilesPerMessage.value = response.policy.maxFilesPerMessage
}, { immediate: true, flush: 'post' })

const connectionState = computed<ConnectionState>(() => {
  if (!connectionResponse.value) {
    return connectionFetchStatus.value === 'error' ? 'error' : 'loading'
  }

  const connection = connectionResponse.value.connection

  if (!connection) {
    return 'not-connected'
  }

  return connection.status === 'active' ? 'connected' : 'reauthorize'
})

const statusSentence = computed<string>(() => {
  if (connectionState.value === 'reauthorize') {
    return GOOGLE_DRIVE_TAB_REAUTHORIZE
  }

  if (connectionState.value === 'error') {
    return GOOGLE_DRIVE_TAB_STATUS_FAILED
  }

  return GOOGLE_DRIVE_TAB_NOT_CONNECTED
})

const isInitialLoading = computed<boolean>(() => {
  return isLoading.value && files.value.length === 0
})

const isEmpty = computed<boolean>(() => {
  return !isLoading.value && files.value.length === 0
})

const resolveFileDelivery = computed<FileDeliveryResolver>(() => {
  return props.resolveDelivery
    ?? createPredicateDeliveryResolver(props.canAttachMediaType)
})

const fileRejections = computed<Map<string, FileRejection>>(() => {
  const rejections = new Map<string, FileRejection>()

  for (const file of loadedFiles.value) {
    const rejection = getFileRejection(file, resolveFileDelivery.value)

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

const textNotes = computed<Record<string, FileDeliveryHint>>(() => {
  const notes: Record<string, FileDeliveryHint> = {}

  for (const file of loadedFiles.value) {
    if (fileRejections.value.has(file.id)) {
      continue
    }

    const note = getFileDeliveryHint(file, resolveFileDelivery.value)

    if (note) {
      notes[file.id] = note
    }
  }

  return notes
})

function getFileName(fileId: string): string {
  const file = files.value.find(candidate => candidate.id === fileId)

  return file ? truncateFilename(file.name, 30) : 'A file'
}

async function afterLibraryChange() {
  await fetchFiles(true)

  emit('changed')
}

const {
  isImporting,
  isRefreshing,
  isBusy,
  isPicking,
  pickMore,
  refreshCopies,
} = useGoogleDriveLibrary({
  getFileName,
  isAttached: fileId => props.attachedIds.has(fileId),
  onReplaceAttached: (previousId, file) => {
    emit('replace', previousId, file)
  },
  onChanged: afterLibraryChange,
  onConnectionIssue: () => {
    refreshConnection()
  },
})

const pickLabel = computed<string>(() => {
  if (isPicking.value) {
    return 'Opening Google Drive'
  }

  if (isImporting.value) {
    return 'Copying'
  }

  return GOOGLE_DRIVE_TAB_PICK_LABEL
})

async function openConnectionSettings() {
  dialog.close()

  await navigateTo(GOOGLE_DRIVE_CONNECT_PATH)
}

function onFileClick(event: MouseEvent, file: FileManagerFile, index: number) {
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

  if (!event.shiftKey && isCurrentlySelected && isAttached) {
    emit('detach', [file.id])
  }

  handleSelect(file.id, index, event.shiftKey)
}

function getAttachedSelectedIds(): string[] {
  return Array.from(selectedIds.value).filter((id) => {
    return props.attachedIds.has(id)
  })
}

function handleDeselectAll() {
  const attachedSelectedIds = getAttachedSelectedIds()

  if (attachedSelectedIds.length > 0) {
    emit('detach', attachedSelectedIds)
  }

  deselectAll()
}

function handleToggleSelectAll() {
  if (allSelected.value) {
    const attachedSelectedIds = getAttachedSelectedIds()

    if (attachedSelectedIds.length > 0) {
      emit('detach', attachedSelectedIds)
    }
  }

  toggleSelectAll()
}

function attachSelected() {
  const selected = getSelectedForAttach()
  const attachable = selected.filter((file) => {
    return !unsupportedReasons.value[file.id]
  })
  const rejections = selected.flatMap((file) => {
    return fileRejections.value.get(file.id) ?? []
  })

  for (const message of getRejectionMessages(
    rejections,
    props.canAttachMediaType,
  )) {
    useWarningMessage(message)
  }

  if (attachable.length === 0) {
    return
  }

  emit('attach', attachable)
}

function refreshOne(file: FileManagerFile) {
  return refreshCopies([file.id])
}

function refreshSelected() {
  return refreshCopies(Array.from(selectedIds.value))
}

async function confirmDelete(file: FileManagerFile) {
  const result = await useConfirm({
    text: `Delete "${truncateFilename(file.name, 30)}" from Besidka? `
      + GOOGLE_DRIVE_TAB_ORIGINAL_KEPT,
    alert: true,
    actions: ['Confirm'],
  })

  if (!result) {
    return
  }

  if (!await deleteFile(file.id)) {
    return
  }

  nuxtApp.callHook('files:deleted', [file.id])
  emit('changed')
}

async function confirmDeleteSelected() {
  const idsToDelete = Array.from(selectedIds.value)
  const count = idsToDelete.length
  const result = await useConfirm({
    text: `Delete ${count} file${count === 1 ? '' : 's'} from Besidka? `
      + (count === 1
        ? GOOGLE_DRIVE_TAB_ORIGINAL_KEPT
        : 'The originals in Google Drive are not deleted.'),
    alert: true,
    actions: ['Confirm'],
  })

  if (!result) {
    return
  }

  if (!await deleteSelected()) {
    return
  }

  nuxtApp.callHook('files:deleted', idsToDelete)
  emit('changed')
}

const renameModalRef = shallowRef<{
  open: (file: FileManagerFile) => void
  close: () => void
} | null>(null)

function openRenameModal(file: FileManagerFile) {
  renameModalRef.value?.open(file)
}

async function handleRenameSubmit(fileId: string, newName: string) {
  if (await renameFile(fileId, newName)) {
    renameModalRef.value?.close()
    emit('changed')
  }
}

const autoSelectedIds = shallowRef<Set<string>>(new Set())

function syncAttachedSelection() {
  let hasChanged = false
  const nextSelectedIds = new Set(selectedIds.value)
  const nextAutoSelectedIds = new Set(autoSelectedIds.value)

  for (const id of autoSelectedIds.value) {
    if (!props.attachedIds.has(id) && nextSelectedIds.has(id)) {
      nextSelectedIds.delete(id)
      nextAutoSelectedIds.delete(id)
      hasChanged = true
    }
  }

  for (const file of loadedFiles.value) {
    if (props.attachedIds.has(file.id) && !nextSelectedIds.has(file.id)) {
      nextSelectedIds.add(file.id)
      nextAutoSelectedIds.add(file.id)
      hasChanged = true
    }
  }

  if (!hasChanged) {
    return
  }

  selectedIds.value = nextSelectedIds
  autoSelectedIds.value = nextAutoSelectedIds
}

watch(files, syncAttachedSelection, { flush: 'post' })
watch(() => props.attachedIds, syncAttachedSelection, { flush: 'post' })

const gridViewRef = shallowRef<{
  containerRef: HTMLDivElement | null
} | null>(null)
const listViewRef = shallowRef<{
  containerRef: HTMLTableElement | null
} | null>(null)

function getViewContainers(): HTMLElement[] {
  const containers: Array<HTMLElement | null | undefined> = [
    gridViewRef.value?.containerRef,
    listViewRef.value?.containerRef,
  ]

  return containers.filter((container): container is HTMLElement => {
    return !!container
  })
}

const boundContainers = new Set<HTMLElement>()

function unbindTouchListeners() {
  for (const container of boundContainers) {
    detachTouchListeners(container)
  }

  boundContainers.clear()
}

async function rebindTouchListeners() {
  await nextTick()
  unbindTouchListeners()

  for (const container of getViewContainers()) {
    attachTouchListeners(container)
    boundContainers.add(container)
  }
}

watch([files, () => props.viewMode, connectionState], rebindTouchListeners, {
  flush: 'post',
})

onMounted(rebindTouchListeners)

onUnmounted(() => {
  unbindTouchListeners()
  resetFileManager()
})
</script>
