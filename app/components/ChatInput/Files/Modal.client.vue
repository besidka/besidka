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
const modal = useTemplateRef<HTMLDialogElement>('modal')
const closeBtn = useTemplateRef<HTMLButtonElement>('closeBtn')
const storageUsage = useTemplateRef('storageUsage')
const selectTabRef = shallowRef<SelectTabRef | null>(null)

const activeTab = shallowRef<Tab | null>(null)
const selectSource = shallowRef<FileSourceFilter | undefined>(undefined)
const shouldRefreshSelect = shallowRef<boolean>(false)

async function refreshSelectTabIfNeeded() {
  if (activeTab.value !== 'select' || !shouldRefreshSelect.value) {
    return
  }

  await nextTick()

  if (!selectTabRef.value) {
    return
  }

  selectTabRef.value.reset()

  const didRefresh = await selectTabRef.value.fetchFiles(true)

  if (didRefresh) {
    shouldRefreshSelect.value = false
  }
}

function open(tab: Tab, source?: FileSourceFilter): void {
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
}

function close(): void {
  if (modal.value?.open) {
    modal.value.close()
  }
}

function onModalClosed(): void {
  if (modal.value?.open) {
    return
  }

  activeTab.value = null
  selectSource.value = undefined
  shouldRefreshSelect.value = true
  selectTabRef.value?.reset()
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

  close()
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
