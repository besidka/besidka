<template>
  <span class="contents">
    <span
      v-if="isUnavailable"
      class="flex shrink-0 items-center justify-center rounded-box bg-base-200 text-base-content/50"
      :class="sizeClass"
      :title="image.deleted ? 'Image deleted' : 'Image not found'"
      data-testid="reasoning-connector-image-deleted"
    >
      <Icon name="lucide:image-off" size="12" aria-hidden="true" />
      <span class="sr-only">
        {{ image.deleted ? 'Image deleted' : 'Image not found' }}
      </span>
    </span>
    <button
      v-else-if="links"
      type="button"
      class="relative block shrink-0 cursor-zoom-in overflow-hidden rounded-box bg-base-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="sizeClass"
      :aria-label="`Preview ${alt}`"
      data-testid="reasoning-connector-image"
      @click.stop.prevent="openPreview"
      @keydown.space.stop
      @keydown.enter.stop
    >
      <img
        :src="links.openUrl"
        :alt="alt"
        :width="image.width"
        :height="image.height"
        class="block size-full object-cover"
        loading="lazy"
        decoding="async"
        @error="onImageError"
      >
      <span
        v-if="extraCount > 0"
        class="absolute inset-0 flex items-center justify-center bg-base-content/50 text-[0.625rem] font-medium text-base-100"
        data-testid="reasoning-connector-image-more"
      >
        +{{ extraCount }}
      </span>
    </button>
    <LazyChatImagePreview
      v-if="isPreviewOpen && previewEntry?.links"
      v-model:open="isPreviewOpen"
      :src="previewEntry.links.openUrl"
      :download-url="previewEntry.links.downloadUrl"
      :alt="previewEntry.alt"
      :filename="previewEntry.image.name"
      :position="{ index: previewIndex, total: previewEntries.length }"
      @navigate="onNavigate"
    />
  </span>
</template>

<script setup lang="ts">
import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'
import type { SafeFileLinks } from '~/utils/files'

interface ConnectorImageEntry {
  image: ConnectorImagePartData
  alt: string
}

interface PreviewEntry extends ConnectorImageEntry {
  links: SafeFileLinks | null
}

const props = withDefaults(defineProps<{
  image: ConnectorImagePartData
  alt: string
  size?: 'sm' | 'md'
  extraCount?: number
  gallery?: ConnectorImageEntry[]
}>(), {
  size: 'md',
  extraCount: 0,
  gallery: () => [],
})

const { isSuppressed: isImagePreviewSuppressed } = useImagePreviewGuard()
const isPreviewOpen = shallowRef<boolean>(false)
const hasLoadError = shallowRef<boolean>(false)
const previewIndex = shallowRef<number>(0)

const previewEntries = computed<PreviewEntry[]>(() => {
  const entries = props.gallery.length > 0
    ? props.gallery.filter(entry => !entry.image.deleted)
    : [{ image: props.image, alt: props.alt }]

  return entries.map((entry) => {
    return { ...entry, links: getSafeFileLinks(entry.image.url) }
  })
})

const previewEntry = computed<PreviewEntry | null>(() => {
  return previewEntries.value[previewIndex.value] ?? null
})

const links = computed(() => getSafeFileLinks(props.image.url))

const isUnavailable = computed<boolean>(() => {
  return !!props.image.deleted || hasLoadError.value || !links.value
})

const sizeClass = computed<string>(() => {
  return props.size === 'sm' ? 'size-6' : 'size-8'
})

function isSameImage(
  left: ConnectorImagePartData,
  right: ConnectorImagePartData,
): boolean {
  return left.toolCallId === right.toolCallId && left.fileId === right.fileId
}

function openPreview() {
  if (isImagePreviewSuppressed.value || !links.value) {
    return
  }

  const index = previewEntries.value.findIndex((entry) => {
    return isSameImage(entry.image, props.image)
  })

  previewIndex.value = Math.max(0, index)
  isPreviewOpen.value = true
}

function onNavigate(direction: -1 | 1) {
  const nextIndex = previewIndex.value + direction

  if (nextIndex < 0 || nextIndex >= previewEntries.value.length) {
    return
  }

  previewIndex.value = nextIndex
}

function onImageError() {
  hasLoadError.value = true

  const current = previewEntry.value

  if (current && isSameImage(current.image, props.image)) {
    isPreviewOpen.value = false
  }
}
</script>
