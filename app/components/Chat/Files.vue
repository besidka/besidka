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
        :key="file.url"
        :aria-label="`File ${file.filename}`"
        class="group carousel-item relative overflow-hidden flex items-center justify-center size-48 rounded-box aspect-square bg-base-300"
      >
        <Icon
          :name="getFileIcon(file.mediaType)"
          size="48"
          class="z-10 text-base-content/40"
        />
        <div
          v-if="failedUrls[file.url]"
          class="absolute z-20 inset-0 flex flex-col items-center justify-center bg-base-300"
        >
          <Icon
            name="lucide:image-off"
            size="32"
            class="text-base-content/40"
          />
          <span class="text-xs text-base-content/50 mt-2">Not found</span>
        </div>
        <img
          v-else-if="isImageFile(file.mediaType)"
          :src="file.url"
          :alt="file.filename"
          class="absolute z-20 inset-0 block size-full shrink-0 aspect-square object-cover"
          loading="lazy"
          @error="onImageError(file.url)"
        >
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

const props = defineProps<{
  message: UIMessage
}>()

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const failedUrls = reactive<Record<string, boolean>>({})

const parts = computed<FileUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'file'
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
    if (img.complete && img.naturalWidth === 0) {
      const url = new URL(img.src)
      failedUrls[url.pathname] = true
    }
  })
})
</script>
