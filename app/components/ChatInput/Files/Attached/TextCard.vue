<template>
  <button
    type="button"
    class="flex items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent cursor-pointer"
    :aria-label="`Open ${file.name}`"
    :title="`Open ${file.name}`"
    data-testid="files-preview-text-open"
    @click="emit('open')"
  >
    <div
      class="flex h-14 w-24 shrink-0 flex-col justify-center gap-px overflow-hidden rounded-sm bg-base-300 px-1.5"
      data-testid="files-preview-text-lines"
    >
      <div
        v-if="isLoadingPreview"
        class="skeleton skeleton--default size-full"
      />
      <template v-else-if="previewLines.length">
        <p
          v-for="(line, lineIndex) in previewLines"
          :key="lineIndex"
          class="truncate font-mono text-[7px] leading-tight text-base-content/70"
        >
          {{ line }}
        </p>
      </template>
      <Icon
        v-else
        :name="getFileIcon(file.type)"
        size="20"
        class="mx-auto text-base-content/40"
      />
    </div>
    <div class="flex min-w-0 flex-col gap-0.5 pr-5">
      <p
        class="truncate text-xs font-medium"
        :title="file.name"
      >
        {{ truncateFilename(file.name) }}
      </p>
      <p
        class="text-[10px] text-base-content/60"
        data-testid="files-preview-text-meta"
      >
        {{ metaLabel }}
      </p>
    </div>
  </button>
</template>

<script setup lang="ts">
import type { FileMetadata } from '#shared/types/files.d'

const props = withDefaults(defineProps<{
  file: Pick<FileMetadata, 'name' | 'type' | 'size'>
    & Partial<Pick<FileMetadata, 'storageKey'>>
  content?: string
}>(), {
  content: undefined,
})

const emit = defineEmits<{
  open: []
}>()

const previewKey = props.file.storageKey || useId()

const shouldFetchPreview = computed<boolean>(() => {
  return props.content === undefined
    && !!props.file.storageKey
    && props.file.size <= TEXT_FILE_PREVIEW_MAX_BYTES
})

const { data: fetchedContent, status } = useLazyAsyncData(
  `text-file-preview:${previewKey}`,
  () => fetchTextFileContent(getFileUrl(previewKey)),
  {
    server: false,
    immediate: shouldFetchPreview.value,
    default: () => null,
  },
)

const textContent = computed<string | null>(() => {
  return props.content ?? fetchedContent.value
})

const isLoadingPreview = computed<boolean>(() => {
  return shouldFetchPreview.value && status.value === 'pending'
})

const previewLines = computed<string[]>(() => {
  return textContent.value ? getTextPreviewLines(textContent.value) : []
})

const metaLabel = computed<string>(() => {
  const sizeLabel = formatFileSize(props.file.size)

  if (textContent.value === null) {
    return sizeLabel
  }

  const lineCount = countTextLines(textContent.value)

  return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}, ${sizeLabel}`
})
</script>
