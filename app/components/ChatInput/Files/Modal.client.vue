<template>
  <div class="contents">
    <Teleport to="body">
      <dialog
        ref="modal"
        data-testid="files-modal"
        class="js-files-modal modal modal-bottom sm:modal-middle"
        @close="onModalClosed"
      >
        <div
          data-testid="files-modal-box"
          class="modal-box max-w-2xl max-h-[80vh] flex flex-col sm:max-w-3xl lg:max-w-5xl sm:h-[85vh] sm:max-h-[85vh]"
        >
          <form method="dialog">
            <button
              ref="closeBtn"
              class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            >
              <Icon name="lucide:x" size="16" />
            </button>
          </form>
          <h3 class="shrink-0 mb-4 text-2xl font-bold text-center">
            File manager
          </h3>

          <!-- Storage Usage -->
          <ChatInputFilesModalStorageUsage
            ref="storageUsage"
            class="shrink-0"
          />

          <div
            role="tablist"
            class="tabs tabs-box max-xs:tabs-xs xs:tabs-sm mb-3 shrink-0"
          >
            <input
              type="radio"
              name="file_manager_tabs"
              class="tab w-1/2"
              aria-label="Select existing files"
              :checked="activeTab === 'select'"
              @change="activeTab = 'select'"
            >
            <input
              type="radio"
              name="file_manager_tabs"
              class="tab w-1/2"
              aria-label="Upload new files"
              :checked="activeTab === 'upload'"
              @change="activeTab = 'upload'"
            >
          </div>
          <KeepAlive>
            <ChatInputFilesModalSelect
              v-if="activeTab === 'select'"
              ref="selectTabRef"
              :attached-ids="attachedIds"
              :initial-source="selectSource"
              :can-attach-media-type="canAttachMediaType"
              :resolve-delivery="resolveDelivery"
              class="flex-1 min-h-0"
              @attach="onFilesAttached"
              @detach="onFilesDetached"
              @preview="onFilePreview"
              @deleted="storageUsage?.fetch()"
            />
            <ChatInputFilesModalUpload
              v-else-if="activeTab === 'upload'"
              :can-attach-media-type="canAttachMediaType"
              class="sm:flex-1 sm:min-h-0"
              @upload="onFilesUploaded"
            />
          </KeepAlive>
        </div>
        <form
          method="dialog"
          class="modal-backdrop"
        >
          <button>Close</button>
        </form>
      </dialog>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  getDocumentDisplayTitle,
  getDocumentFormatFromMediaType,
} from '#shared/utils/documents'
import type {
  AttachedFile,
  FileManagerFile,
  FileSourceFilter,
} from '~/types/file-manager'
import type { FileDeliveryResolver } from '~/utils/file-delivery-hints'

type Tab = 'select' | 'upload'
type SelectTabRef = {
  reset: () => void
  fetchFiles: (reset?: boolean) => Promise<boolean>
  getScrollTop: () => number
  setScrollTop: (scrollTop: number) => void
}

withDefaults(defineProps<{
  attachedIds: Set<string>
  canAttachMediaType?: (mediaType: string) => boolean
  resolveDelivery?: FileDeliveryResolver
}>(), {
  canAttachMediaType: () => true,
  resolveDelivery: undefined,
})

const emit = defineEmits<{
  attach: [files: AttachedFile[]]
  detach: [fileIds: string[]]
  upload: [files: File[]]
}>()

const documentPreview = useDocumentPreview()
const sidePanel = useSidePanel()
const route = useRoute()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const closeBtn = useTemplateRef<HTMLButtonElement>('closeBtn')
const storageUsage = useTemplateRef('storageUsage')
const selectTabRef = shallowRef<SelectTabRef | null>(null)

const activeTab = shallowRef<Tab | null>(null)
const selectSource = shallowRef<FileSourceFilter | undefined>(undefined)
const shouldRefreshSelect = shallowRef<boolean>(false)
const stopPreviewReturnWatch = shallowRef<(() => void) | null>(null)
let refreshGeneration = 0
let activeRefreshGeneration: number | null = null

/**
 * A refresh is identified by a generation. Resetting the modal state bumps
 * the generation, which both frees the slot, so a reopen can start a new
 * refresh at once, and makes the older fetch stale: its late result neither
 * marks the tab as refreshed nor clears the newer refresh's slot.
 */
async function refreshSelectTabIfNeeded() {
  if (activeTab.value !== 'select' || !shouldRefreshSelect.value) {
    return
  }

  if (activeRefreshGeneration === refreshGeneration) {
    return
  }

  const generation = ++refreshGeneration

  activeRefreshGeneration = generation

  try {
    await nextTick()

    if (generation !== refreshGeneration || !selectTabRef.value) {
      return
    }

    selectTabRef.value.reset()

    const didRefresh = await selectTabRef.value.fetchFiles(true)

    if (didRefresh && generation === refreshGeneration) {
      shouldRefreshSelect.value = false
    }
  } finally {
    if (activeRefreshGeneration === generation) {
      activeRefreshGeneration = null
    }
  }
}

function open(tab: Tab, source?: FileSourceFilter): void {
  const isAbandoningPreviewReturn = stopPreviewReturnWatch.value !== null

  if (isAbandoningPreviewReturn) {
    cancelPreviewReturn()
    resetModalState()
  }

  activeTab.value = tab
  selectSource.value = tab === 'select' ? source ?? 'upload' : undefined

  if (modal.value && !modal.value?.open) {
    modal.value.showModal()
    storageUsage.value?.fetch()

    setTimeout(() => {
      if (!modal.value?.open) {
        return
      }

      closeBtn.value?.focus()
    }, 300)
  }

  if (isAbandoningPreviewReturn) {
    refreshSelectTabIfNeeded()
  }
}

function close(): void {
  if (modal.value?.open) {
    modal.value.close()
  }
}

function resetModalState(): void {
  refreshGeneration++
  activeRefreshGeneration = null
  activeTab.value = null
  selectSource.value = undefined
  shouldRefreshSelect.value = true
  selectTabRef.value?.reset()
}

function onModalClosed(): void {
  if (modal.value?.open || stopPreviewReturnWatch.value) {
    return
  }

  resetModalState()
}

function cancelPreviewReturn(): void {
  stopPreviewReturnWatch.value?.()
  stopPreviewReturnWatch.value = null
}

async function returnFromPreview(scrollTop: number): Promise<void> {
  cancelPreviewReturn()

  if (!modal.value || modal.value.open) {
    return
  }

  modal.value.showModal()
  storageUsage.value?.fetch()

  await nextTick()

  selectTabRef.value?.setScrollTop(scrollTop)
}

function abandonPreviewReturn(): void {
  cancelPreviewReturn()
  resetModalState()
}

function isEditableOutsideSidePanel(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.closest('.js-side-panel, .js-side-panel-sheet')) {
    return false
  }

  return !!target.closest('textarea, input, [contenteditable]')
}

/**
 * The side panel lives outside the dialog's top layer, so the dialog is
 * closed while a preview shows. Its state (tab, filter, search, selection)
 * is kept and the dialog reopens with the same scroll position once the side
 * panel closes. The kept state is dropped, so the dialog cannot pop up later
 * by surprise, when another view takes the panel, the route changes, or the
 * user moves on to the composer or any other field while the panel is still
 * open. Focus the side panel hands back to its opener as it closes is not that.
 */
function closeForPreview(documentId: string): void {
  const scrollTop = selectTabRef.value?.getScrollTop() ?? 0

  cancelPreviewReturn()

  const stopPanelWatch = watch(
    () => documentPreview.isShowing(documentId),
    async (isShowing) => {
      if (isShowing) {
        return
      }

      if (sidePanel.isOpen.value) {
        abandonPreviewReturn()

        return
      }

      await returnFromPreview(scrollTop)
    },
    { flush: 'post' },
  )
  const stopRouteWatch = watch(() => route.fullPath, abandonPreviewReturn)
  const onFocusIn = (event: FocusEvent) => {
    if (sidePanel.isOpen.value && isEditableOutsideSidePanel(event.target)) {
      abandonPreviewReturn()
    }
  }

  stopPreviewReturnWatch.value = () => {
    stopPanelWatch()
    stopRouteWatch()
    document.removeEventListener('focusin', onFocusIn)
  }
  close()
  document.addEventListener('focusin', onFocusIn)
}

function onFilesAttached(files: FileManagerFile[]) {
  const attachedFiles: AttachedFile[] = files.map((file) => {
    return {
      id: file.id,
      storageKey: file.storageKey,
      name: file.name,
      size: file.size,
      type: file.type,
      textStatus: file.textStatus,
      textBytes: file.textBytes,
      textTruncated: file.textTruncated,
      textOmittedMedia: file.textOmittedMedia,
      textOmittedCharts: file.textOmittedCharts,
    }
  })

  emit('attach', attachedFiles)
  close()
}

function onFilePreview(file: FileManagerFile) {
  const format = getDocumentFormatFromMediaType(file.type)

  if (!file.documentId || !format) {
    return
  }

  closeForPreview(file.documentId)
  documentPreview.open({
    documentId: file.documentId,
    format,
    title: getDocumentDisplayTitle(file.name, format),
    storageKey: file.storageKey,
  })
}

function onFilesDetached(fileIds: string[]) {
  emit('detach', fileIds)
}

function onFilesUploaded(files: File[]) {
  emit('upload', files)
  close()
}

onBeforeUnmount(cancelPreviewReturn)

watch([activeTab, selectTabRef], () => {
  void refreshSelectTabIfNeeded()
}, { flush: 'post' })

defineExpose({
  open,
  close,
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.overlay-enter-active,
.overlay-leave-active,
.confirm-enter-active,
.confirm-leave-active {
    @apply transition-all duration-500;
}

.overlay-enter-from,
.overlay-leave-to {
    @apply opacity-0 invisible;
}

.confirm-enter-from,
.confirm-leave-to {
    @apply opacity-0 invisible -translate-y-8;
}
</style>
