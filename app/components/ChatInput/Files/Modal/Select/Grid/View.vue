<template>
  <div
    ref="containerRef"
    class="grid grid-cols-3 sm:grid-cols-4 gap-2 py-1 select-none"
  >
    <button
      v-for="(file, index) in files"
      :key="file.id"
      type="button"
      :data-file-index="index"
      class="group relative aspect-square rounded-box overflow-hidden bg-base-200 hover:ring-2 hover:ring-text/50 transition-all focus:outline-none focus:ring-2 focus:ring-text"
      :class="{
        'ring-2 ring-text': selectedIds.has(file.id),
        'ring-2 ring-secondary-content/50':
          isTouchSelecting && touchedIndices.has(index)
      }"
      @click="$emit('file-click', $event, file, index)"
    >
      <!-- Image Preview -->
      <img
        v-if="isImageFile(file.type)"
        :src="getFileUrl(file.storageKey)"
        :alt="file.name"
        class="size-full object-cover"
        :class="{
          'opacity-50': selectedIds.has(file.id)
        }"
        loading="lazy"
      >
      <!-- File Icon for non-images -->
      <div
        v-else
        class="size-full flex flex-col items-center justify-center p-2"
        :class="{
          'opacity-50': selectedIds.has(file.id)
        }"
      >
        <Icon
          :name="getFileIcon(file.type)"
          size="24"
          class="text-base-content/40 mb-1"
        />
        <p
          class="text-[10px] text-base-content/60 truncate w-full text-center"
        >
          {{ truncateFilename(file.name, 12) }}
        </p>
      </div>

      <!-- Selection Overlay -->
      <div
        v-if="selectedIds.has(file.id)"
        class="absolute inset-0 bg-primary/20 flex items-center justify-center"
      >
        <div
          class="size-6 bg-primary rounded-full flex items-center justify-center"
        >
          <Icon
            name="lucide:check"
            size="14"
            class="text-primary-content"
          />
        </div>
      </div>

      <div class="absolute -bottom-0 right-1 z-10">
        <ChatInputFilesModalSelectExpirationBadge
          :expires-at="file.expiresAt"
          :tooltip="false"
          :compact="true"
          :show-terminal-labels="false"
          :show-only-alerts="true"
        />
      </div>

      <!-- Hover/Focus Actions -->
      <div
        class="absolute top-1 right-1 flex gap-0.5"
        :class="{
          [`
            md:opacity-0
            group-hover:opacity-100
            group-focus:opacity-100 focus-within:opacity-100
            transition-opacity
          `]: $device.isDesktop
        }"
        @click.stop
      >
        <button
          type="button"
          class="btn btn-circle btn-xs btn-soft"
          aria-label="Rename file"
          title="Rename"
          @click="$emit('rename', file)"
        >
          <Icon name="lucide:pencil" size="12" />
        </button>
        <button
          type="button"
          class="btn btn-circle btn-xs btn-error btn-soft"
          aria-label="Delete file"
          title="Delete"
          @click="$emit('delete', file)"
        >
          <Icon name="lucide:trash-2" size="12" />
        </button>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { FileManagerFile } from '~/types/file-manager'

defineProps<{
  files: FileManagerFile[]
  selectedIds: Set<string>
  isTouchSelecting: boolean
  touchedIndices: Set<number>
}>()

defineEmits<{
  'file-click': [event: MouseEvent, file: FileManagerFile, index: number]
  'rename': [file: FileManagerFile]
  'delete': [file: FileManagerFile]
}>()

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')

defineExpose({
  containerRef,
})
</script>
