<template>
  <div class="contents">
    <Teleport to="body">
      <dialog
        ref="modal"
        data-testid="files-modal"
        class="js-files-modal modal modal-bottom sm:modal-middle"
      >
        <div class="modal-box max-w-2xl max-h-[80vh] flex flex-col">
          <form method="dialog">
            <button
              ref="closeBtn"
              class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            >
              <Icon name="lucide:x" size="16" />
            </button>
          </form>
          <h3 class="mb-4 text-2xl font-bold text-center">
            File manager
          </h3>

          <!-- Storage Usage -->
          <ChatInputFilesModalStorageUsage
            ref="storageUsage"
          />

          <div role="tablist" class="tabs tabs-box max-xs:tabs-xs xs:tabs-sm mb-3">
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
          <ChatInputFilesModalSelect
            v-if="activeTab === 'select'"
            :attached-ids="attachedIds"
            class="flex-1 min-h-0"
            @attach="onFilesAttached"
            @detach="onFilesDetached"
            @deleted="storageUsage?.fetch()"
          />
          <ChatInputFilesModalUpload
            v-if="activeTab === 'upload'"
            @upload="onFilesUploaded"
          />
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
import type { FileMetadata } from '#shared/types/files.d'
import type { FileManagerFile } from '~/types/file-manager'

type Tab = 'select' | 'upload'

defineProps<{
  attachedIds: Set<string>
}>()

const emit = defineEmits<{
  attach: [files: Pick<FileMetadata, 'id' | 'storageKey' | 'name' | 'size' | 'type'>[]]
  detach: [fileIds: string[]]
  upload: [files: File[]]
}>()

const modal = useTemplateRef<HTMLDialogElement>('modal')
const closeBtn = useTemplateRef<HTMLButtonElement>('close')
const storageUsage = useTemplateRef('storageUsage')

const activeTab = shallowRef<Tab | null>(null)

function open(tab: Tab): void {
  activeTab.value = tab

  if (modal.value && !modal.value?.open) {
    modal.value.showModal()
    storageUsage.value?.fetch()

    setTimeout(() => {
      closeBtn.value?.focus()
    }, 300)
  }
}

function close(): void {
  if (modal.value?.open) {
    modal.value.close()
  }

  activeTab.value = null
}

function onFilesAttached(files: FileManagerFile[]) {
  const attachedFiles = files.map(({ id, storageKey, name, size, type }) => ({
    id,
    storageKey,
    name,
    size,
    type,
  }))

  emit('attach', attachedFiles)
  close()
}

function onFilesDetached(fileIds: string[]) {
  emit('detach', fileIds)
}

function onFilesUploaded(files: File[]) {
  emit('upload', files)
  close()
}

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
