<template>
  <div
    v-if="hasAnyFiles"
    class="overflow-hidden attached-files mb-1.5"
    role="region"
    :aria-label="`${totalFilesCount === 1 ? 'File' : 'Files'}`"
  >
    <!-- Screen reader announcements -->
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ uploadStatusAnnouncement }}
    </div>

    <div
      ref="carouselRef"
      class="carousel flex gap-1.5 w-full py-1 px-0 rounded-box"
    >
      <!-- Completed/attached files -->
      <div
        v-for="file in files"
        :key="file.storageKey"
        :aria-label="`File ${file.name}`"
        class="carousel-item flex items-center gap-1 relative"
      >
        <div
          v-if="isImageFile(file.type)"
          class="flex items-center justify-center size-16 rounded-box aspect-square bg-base-300 relative overflow-hidden"
        >
          <img
            v-if="isImageFile(file.type)"
            :src="getFileUrl(file.storageKey)"
            :alt="file.name"
            class="shrink-0 size-full object-cover"
            loading="lazy"
          >
        </div>
        <div
          v-else
          class="flex items-center justify-center gap-1 bg-base-100/70 rounded-box p-1"
        >
          <div
            class="flex items-center justify-center size-14 rounded-sm aspect-square bg-base-300 relative overflow-hidden"
          >
            <Icon
              :name="getFileIcon(file.type)"
              size="20"
              class="text-base-content/40"
            />
          </div>
          <p
            class="pr-2 text-xs font-medium truncate"
            :title="file.name"
          >
            {{ truncateFilename(file.name) }}
          </p>
        </div>
        <button
          class="absolute top-1 right-1 btn btn-circle btn-xs btn-error btn-soft size-4"
          :aria-label="`Remove ${file.name}`"
          :title="`Remove ${file.name}`"
          data-testid="files-preview-detach"
          @click="removeAttachedFile(file.storageKey)"
        >
          <Icon
            name="lucide:x"
            size="10"
          />
        </button>
      </div>

      <!-- Uploading files -->
      <div
        v-for="uploadingFile in uploadingFilesArray"
        :key="uploadingFile.id"
        :aria-label="
          `File ${uploadingFile.file.name}, ${uploadingFile.progress}% uploaded`
        "
        class="carousel-item flex items-center gap-1 relative"
      >
        <!-- Image preview with progress overlay -->
        <div
          v-if="isImageFile(uploadingFile.file.type)"
          class="flex items-center justify-center size-16 rounded-box aspect-square bg-base-300 relative overflow-hidden"
        >
          <img
            v-if="uploadingFile.previewUrl"
            :src="uploadingFile.previewUrl"
            :alt="uploadingFile.file.name"
            class="shrink-0 size-full object-cover"
            :class="{
              'opacity-50 blur-[1px]': uploadingFile.status !== 'completed',
            }"
            loading="lazy"
          >
          <div
            v-else
            class="w-full h-full flex items-center justify-center"
          >
            <Icon
              :name="getFileIcon(uploadingFile.file.type)"
              size="24"
              class="text-base-content/40"
            />
          </div>

          <!-- Progress overlay for images -->
          <div
            v-if="uploadingFile.status !== 'completed'"
            class="absolute inset-0 flex items-center justify-center bg-base-300/30"
          >
            <div class="flex flex-col items-center gap-1">
              <Icon
                v-if="uploadingFile.status === 'uploading'"
                name="lucide:loader-circle"
                size="16"
                class="text-info animate-spin"
              />
              <Icon
                v-else-if="uploadingFile.status === 'waiting'"
                name="lucide:clock"
                size="16"
                class="text-warning"
              />
              <Icon
                v-else-if="uploadingFile.status === 'failed'"
                name="lucide:circle-alert"
                size="16"
                class="text-error"
              />
            </div>
          </div>

          <!-- Progress bar for images -->
          <progress
            v-if="
              uploadingFile.status === 'uploading'
                || uploadingFile.status === 'waiting'
            "
            :value="uploadingFile.progress"
            max="100"
            class="progress progress-info w-full h-1 absolute bottom-0 left-0 rounded-none"
            :aria-label="`Upload progress for ${uploadingFile.file.name}`"
          />
        </div>

        <!-- Non-image file preview -->
        <div
          v-else
          class="flex items-center justify-center gap-1 bg-base-100/70 rounded-box p-1 relative"
        >
          <div
            class="flex items-center justify-center size-14 rounded-sm aspect-square bg-base-300 relative overflow-hidden"
            :class="{
              'opacity-50': uploadingFile.status !== 'completed',
            }"
          >
            <Icon
              :name="getFileIcon(uploadingFile.file.type)"
              size="20"
              class="text-base-content/40"
            />
          </div>
          <div class="flex flex-col gap-1">
            <p
              class="pr-2 text-xs font-medium truncate"
              :title="uploadingFile.file.name"
            >
              {{ truncateFilename(uploadingFile.file.name) }}
            </p>
            <!-- Status indicator -->
            <span class="text-[10px] flex items-center gap-0.5">
              <template v-if="uploadingFile.status === 'waiting'">
                <Icon name="lucide:clock" size="10" class="text-warning" />
                <span class="text-base-content/60">Waiting...</span>
              </template>
              <template v-else-if="uploadingFile.status === 'uploading'">
                <Icon
                  name="lucide:loader-2"
                  size="10"
                  class="text-info animate-spin"
                />
                <span class="text-base-content/60">
                  {{ uploadingFile.progress }}%
                </span>
              </template>
              <template v-else-if="uploadingFile.status === 'failed'">
                <Icon
                  name="lucide:alert-circle"
                  size="10"
                  class="text-error"
                />
                <span class="text-error">Failed</span>
              </template>
            </span>
          </div>

          <!-- Progress bar for non-images -->
          <progress
            v-if="
              uploadingFile.status === 'uploading'
                || uploadingFile.status === 'waiting'
            "
            :value="uploadingFile.progress"
            max="100"
            class="progress progress-info w-full h-1 absolute bottom-0 left-0 rounded-none rounded-b-box"
            :aria-label="`Upload progress for ${uploadingFile.file.name}`"
          />
        </div>

        <!-- Action buttons for uploading files -->
        <div class="absolute top-1 right-1 flex gap-0.5">
          <button
            v-if="uploadingFile.status === 'failed'"
            class="btn btn-circle btn-xs btn-warning btn-soft size-4"
            :aria-label="`Retry upload for ${uploadingFile.file.name}`"
            :title="`Retry upload`"
            @click="emit('retry', uploadingFile.id)"
          >
            <Icon name="lucide:rotate-cw" size="10" />
          </button>
          <button
            v-if="uploadingFile.status !== 'completed'"
            class="btn btn-circle btn-xs btn-error btn-soft size-4"
            :aria-label="`Cancel upload for ${uploadingFile.file.name}`"
            title="Cancel upload"
            @click="emit('cancel', uploadingFile.id)"
          >
            <Icon name="lucide:x" size="10" />
          </button>
        </div>
      </div>

      <!-- Remove all button -->
      <div
        v-if="showRemoveAll"
        class="carousel-item flex items-center"
      >
        <button
          class="indicator indicator-middle btn btn-error btn-soft size-16"
          aria-label="Detach all files"
          title="Detach all files"
          data-testid="files-preview-detach-all"
          @click="removeAllFiles"
        >
          <Icon
            name="lucide:file-x-corner"
            size="20"
          />
          <span class="sr-only">Detach all files</span>
          <span class="indicator-item badge badge-error badge-xs">
            {{ totalFilesCount }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileMetadata } from '#shared/types/files.d'
import type { UploadingFile } from '~/composables/chat-files'

const props = defineProps<{
  files: Pick<FileMetadata, 'storageKey' | 'name' | 'type' | 'size'>[]
  uploadingFiles?: Map<string, UploadingFile>
  uploadingCount?: number
}>()

const emit = defineEmits<{
  remove: [fileId: string]
  removeAll: []
  cancel: [fileId: string]
  retry: [fileId: string]
}>()

const carouselRef = useTemplateRef<HTMLDivElement>('carousel')

const uploadingFilesArray = computed<UploadingFile[]>(() => {
  if (!props.uploadingFiles) {
    return []
  }

  return Array.from(props.uploadingFiles.values()).filter((file) => {
    return file.status !== 'completed'
  })
})

const hasAnyFiles = computed<boolean>(() => {
  return props.files.length > 0
    || uploadingFilesArray.value.length > 0
})

const totalFilesCount = computed<number>(() => {
  return props.files.length + uploadingFilesArray.value.length
})

const showRemoveAll = computed<boolean>(() => {
  return totalFilesCount.value > 1
})

const uploadStatusAnnouncement = computed<string>(() => {
  const uploadingCount = props.uploadingCount || 0
  const totalUploading = props.uploadingFiles?.size || 0

  if (uploadingCount > 0) {
    return `Uploading ${uploadingCount} of ${totalUploading} files`
  } else if (totalUploading > 0 && uploadingCount === 0) {
    return `All ${totalUploading} files uploaded successfully`
  }

  return ''
})

async function scrollToEnd() {
  await nextTick()

  carouselRef.value?.scrollTo({
    left: Number.MAX_SAFE_INTEGER,
    behavior: 'smooth',
  })
}

function removeAttachedFile(storageKey: FileMetadata['storageKey']) {
  useConfirmationModal(
    emit,
    ['remove', storageKey],
    'Are you sure you want to detach this file?',
  )
}

function removeAllFiles() {
  useConfirmationModal(
    emit,
    ['removeAll'],
    `Detach all ${totalFilesCount.value} files?`,
  )
}

watch(() => uploadingFilesArray.value.length, (newCount, oldCount) => {
  if (newCount > oldCount) {
    scrollToEnd()
  }
}, {
  flush: 'post',
})

watch(() => props.files.length, (newCount, oldCount) => {
  if (newCount > oldCount) {
    scrollToEnd()
  }
}, {
  flush: 'post',
})
</script>
