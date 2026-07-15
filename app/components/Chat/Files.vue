<template>
  <div
    v-if="parts.length"
    ref="containerRef"
    class="overflow-hidden attached-files mb-2"
    role="region"
    :aria-label="`${parts.length === 1 ? 'File' : 'Files'}`"
  >
    <div class="carousel flex gap-2 w-full rounded-box">
      <div
        v-for="file in parts"
        :key="file.displayKey"
        :aria-label="`File ${file.filename || 'attachment'}`"
        class="group carousel-item relative overflow-hidden flex items-center justify-center size-48 rounded-box aspect-square bg-base-300"
      >
        <Icon
          :name="getFileIcon(file.mediaType)"
          size="48"
          class="z-10 text-base-content/40"
        />
        <div
          v-if="!file.links || failedUrls[file.links.openUrl]"
          data-testid="chat-file-unavailable"
          class="absolute z-20 inset-0 flex flex-col items-center justify-center bg-base-300"
        >
          <Icon
            name="lucide:image-off"
            size="32"
            class="text-base-content/40"
          />
          <span class="text-xs text-base-content/50 mt-2">
            {{ file.links ? 'Not found' : 'Unavailable' }}
          </span>
        </div>
        <img
          v-else-if="file.links && isImageFile(file.mediaType)"
          :src="file.links.openUrl"
          :alt="file.filename || 'Attached image'"
          class="absolute z-20 inset-0 block size-full shrink-0 aspect-square object-cover"
          loading="lazy"
          @error="onImageError(file.links.openUrl)"
        >
        <div
          v-if="file.links && !failedUrls[file.links.openUrl]"
          class="absolute z-30 top-2 right-2 flex gap-1"
          :class="{
            [
              'md:opacity-0 md:group-hover:opacity-100 '
              + 'md:focus-within:opacity-100 transition-opacity'
            ]: $device.isDesktop,
          }"
        >
          <a
            :href="file.links.openUrl"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="chat-file-open"
            class="btn btn-circle btn-xs btn-soft"
            :aria-label="`Open ${file.filename || 'file'}`"
            title="Open"
          >
            <Icon name="lucide:external-link" size="12" />
          </a>
          <a
            :href="file.links.downloadUrl"
            data-testid="chat-file-download"
            class="btn btn-circle btn-xs btn-soft"
            :aria-label="`Download ${file.filename || 'file'}`"
            title="Download"
          >
            <Icon name="lucide:download" size="12" />
          </a>
        </div>
        <div
          v-if="file.filename"
          :title="file.filename"
          class="absolute z-30 bottom-0 -inset-x-0 py-1 px-2 bg-base-100/90 text-base-content text-xs font-medium truncate"
          :class="{
            [`
              md:transition-transform
              md:translate-y-full
              md:group-hover:translate-y-0
            `]: $device.isDesktop && isImageFile(file.mediaType),
          }"
        >
          {{ truncateFilename(file.filename) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, FileUIPart } from 'ai'
import type { SafeFileLinks } from '~/utils/files'

interface DisplayFile {
  displayKey: string
  filename?: string
  mediaType: FileUIPart['mediaType']
  links: SafeFileLinks | null
}

const props = defineProps<{
  message: UIMessage
}>()

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const failedUrls = reactive<Record<string, boolean>>({})

const parts = computed<DisplayFile[]>(() => {
  return props.message.parts.flatMap((part, index) => {
    if (part.type !== 'file') {
      return []
    }

    return [{
      displayKey: `${index}:${part.filename || 'file'}`,
      filename: part.filename,
      mediaType: part.mediaType,
      links: getSafeFileLinks(part.url),
    }]
  })
})

function onImageError(url: string) {
  failedUrls[url] = true
}

onMounted(() => {
  if (!containerRef.value) {
    return
  }

  const images = containerRef.value.querySelectorAll('img')

  images.forEach((img) => {
    if (img.complete && img.currentSrc && img.naturalWidth === 0) {
      const imageUrl = img.getAttribute('src')

      if (imageUrl) {
        failedUrls[imageUrl] = true
      }
    }
  })
})
</script>
