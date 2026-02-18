<template>
  <table
    ref="containerRef"
    class="table table-xs table-pin-rows select-none"
  >
    <thead>
      <tr>
        <th class="w-8 pb-2">
          <label class="cursor-pointer flex items-center justify-center">
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="allSelected"
              :indeterminate="hasSelection && !allSelected"
              @change="$emit('toggle-select-all')"
            >
          </label>
        </th>
        <th class="w-10 pb-2" />
        <th class="pb-2">
          <span class="max-sm:sr-only">Name</span>
        </th>
        <th class="w-20 pb-2 sm:table-cell">
          <span class="max-sm:sr-only">Type</span>
        </th>
        <th class="max-sm:sr-only w-20 pb-2">Size</th>
        <th class="max-sm:sr-only w-28 pb-2">Expires</th>
        <th class="max-sm:sr-only w-20 pb-2">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(file, index) in files"
        :key="file.id"
        :data-file-index="index"
        class="hover cursor-pointer"
        :class="{
          'bg-primary/10 dark:bg-primary-content/10':
            selectedIds.has(file.id)
        }"
        @click="$emit('file-click', $event, file, index)"
      >
        <td @click.stop>
          <label class="cursor-pointer flex items-center justify-center">
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="selectedIds.has(file.id)"
              @click="
                (event: MouseEvent) => $emit('file-click', event, file, index)
              "
            >
          </label>
        </td>
        <td>
          <div
            class="size-8 rounded-sm overflow-hidden bg-base-200 flex items-center justify-center"
          >
            <img
              v-if="isImageFile(file.type)"
              :src="getFileUrl(file.storageKey)"
              :alt="file.name"
              class="size-full object-cover"
              loading="lazy"
            >
            <Icon
              v-else
              :name="getFileIcon(file.type)"
              size="16"
              class="text-base-content/40"
            />
          </div>
        </td>
        <td>
          <div class="max-w-[150px]">
            <span
              class="block"
              :title="file.name"
            >
              {{ truncateFilenameMiddle(file.name, 24) }}
            </span>
            <span class="text-base-content/60 text-2xs sm:hidden">
              Size: {{ formatFileSize(file.size) }}, Type:
              {{ getFileTypeLabel(file.type) }}
            </span>
            <div class="sm:hidden">
              <ChatInputFilesModalSelectExpirationBadge
                :expires-at="file.expiresAt"
                :show-only-alerts="true"
              />
            </div>
          </div>
        </td>
        <td class="hidden sm:table-cell">
          <span class="text-base-content/60 text-xs">
            {{ getFileTypeLabel(file.type) }}
          </span>
        </td>
        <td class="hidden sm:table-cell">
          <span class="text-base-content/60 text-xs">
            {{ formatFileSize(file.size) }}
          </span>
        </td>
        <td class="hidden sm:table-cell">
          <ChatInputFilesModalSelectExpirationBadge
            :expires-at="file.expiresAt"
            :tooltip="true"
          />
        </td>
        <td @click.stop>
          <div class="flex justify-end gap-0.5">
            <button
              type="button"
              class="btn btn-circle btn-xs btn-ghost"
              aria-label="Rename file"
              title="Rename"
              @click="$emit('rename', file)"
            >
              <Icon name="lucide:pencil" size="12" />
            </button>
            <button
              type="button"
              class="btn btn-circle btn-xs btn-soft btn-error"
              aria-label="Delete file"
              title="Delete"
              @click="$emit('delete', file)"
            >
              <Icon name="lucide:trash-2" size="12" />
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { FileManagerFile } from '~/types/file-manager'

defineProps<{
  files: FileManagerFile[]
  selectedIds: Set<string>
  isTouchSelecting: boolean
  touchedIndices: Set<number>
  allSelected: boolean
  hasSelection: boolean
}>()

defineEmits<{
  'file-click': [event: MouseEvent, file: FileManagerFile, index: number]
  'rename': [file: FileManagerFile]
  'delete': [file: FileManagerFile]
  'toggle-select-all': []
}>()

const containerRef = useTemplateRef<HTMLTableElement>('containerRef')

function getFileTypeLabel(type: string): string {
  const parts = type.split('/')

  return parts[1]?.toUpperCase() || type
}

defineExpose({
  containerRef,
})
</script>
