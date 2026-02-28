<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top dropdown-start"
  >
    <summary
      data-testid="files-trigger"
      class="indicator indicator-top indicator-end btn btn-xs btn-accent btn-ghost btn-ghost-legacy btn-circle"
      :class="{ 'btn-active': files.length > 0 || isDropdownHovered }"
      aria-label="Attach files"
    >
      <Icon name="lucide:paperclip" :size="16" />
      <span
        v-if="files.length"
        class="indicator-item badge badge-accent badge-xs size-4 p-0 rounded-full text-[.5rem]"
      >
        {{ files.length }}
      </span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-48 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <li>
              <button
                data-testid="files-open-select"
                type="button"
                @click="openModal('select')"
              >
                <Icon name="lucide:file-check" size="16" />
                Select existing files
              </button>
            </li>
            <li>
              <button
                data-testid="files-open-upload"
                type="button"
                @click="openModal('upload')"
              >
                <Icon name="lucide:cloud-upload" size="16" />
                Upload new files
              </button>
            </li>
            <li
              :class="{
                'menu-disabled': !files.length
              }"
            >
              <button
                type="button"
                class="flex w-full justify-start text-error disabled:opacity-50"
                :disabled="files.length ? undefined : true"
                @click="onDetachAllFiles"
              >
                <span class="flex items-center gap-2 grow">
                  <Icon name="lucide:file-x-corner" size="16" />
                  Detach all files
                </span>
                <span
                  v-if="files.length"
                  class="indicator-item badge badge-error badge-xs text-[.5rem]"
                >
                  {{ files.length }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
  <ClientOnly>
    <LazyChatInputFilesModal
      ref="filesModal"
      :attached-ids="attachedIds"
      @attach="onFilesAttached"
      @detach="onFilesDetached"
      @upload="onFilesUpload"
    />
  </ClientOnly>
</template>

<script setup lang="ts">
import type { FileMetadata } from '#shared/types/files.d'
import { LazyChatInputFilesModal } from '#components'

const props = defineProps<{
  files: FileMetadata[]
}>()

const attachedIds = computed<Set<FileMetadata['id']>>(() => {
  return new Set(props.files.map(file => file.id))
})

const emit = defineEmits<{
  detachAll: []
  attach: [files: Pick<FileMetadata, 'id' | 'storageKey' | 'name' | 'size' | 'type'>[]]
  detach: [fileIds: string[]]
  upload: [files: File[]]
}>()

const { isIos, isAndroid } = useDevice()

const filesModal = ref<
  InstanceType<typeof LazyChatInputFilesModal> | null
>(null)
const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')

const isDropdownHovered = useElementHover(dropdown)

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function closeDropdown() {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
}

function openModal(tab: 'select' | 'upload') {
  closeDropdown()
  filesModal.value?.open(tab)
}

function detachAllFiles() {
  emit('detachAll')
  closeDropdown()
}

async function onDetachAllFiles() {
  const result = await useConfirm({
    text: 'Are you sure you want to detach all files?',
    actions: ['Confirm'],
  })

  if (!result) return

  detachAllFiles()
}

function onFilesAttached(
  files: Pick<FileMetadata, 'id' | 'storageKey' | 'name' | 'size' | 'type'>[],
) {
  emit('attach', files)
}

function onFilesDetached(fileIds: string[]) {
  emit('detach', fileIds)
}

function onFilesUpload(files: File[]) {
  emit('upload', files)
}
</script>
