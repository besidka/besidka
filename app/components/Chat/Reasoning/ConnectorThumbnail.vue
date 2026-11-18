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
    <span
      v-else-if="isStacked"
      class="flex shrink-0 items-center gap-1"
    >
      <button
        type="button"
        class="stack stack-end shrink-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-box"
        :class="stackSizeClass"
        :aria-label="stackLabel"
        data-testid="reasoning-connector-image-stack"
        @click.stop.prevent="openPreview"
        @keydown.space.stop
        @keydown.enter.stop
      >
        <img
          v-for="layer in stackLayers"
          :key="`${layer.image.toolCallId}:${layer.image.fileId}`"
          :src="layer.links!.openUrl"
          alt=""
          :width="layer.image.width"
          :height="layer.image.height"
          class="block rounded-box bg-base-300 object-cover"
          loading="lazy"
          decoding="async"
          @error="onLayerError(layer.links!.openUrl)"
        >
      </button>
      <span
        v-if="hiddenCount > 0"
        class="badge badge-soft badge-xs shrink-0"
        data-testid="reasoning-connector-image-more"
      >
        +{{ hiddenCount }}
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

const STACK_LAYERS_MAX = 3

const props = withDefaults(defineProps<{
  image: ConnectorImagePartData
  alt: string
  size?: 'sm' | 'md'
  gallery?: ConnectorImageEntry[]
  stackLabel?: string
}>(), {
  size: 'md',
  gallery: () => [],
  stackLabel: '',
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

const failedLayerUrls = reactive<Record<string, boolean>>({})

const stackEntries = computed<PreviewEntry[]>(() => {
  return previewEntries.value.filter((entry) => {
    return !!entry.links && !failedLayerUrls[entry.links.openUrl]
  })
})

const isStacked = computed<boolean>(() => {
  return !props.image.deleted && stackEntries.value.length > 1
})

const stackLayers = computed<PreviewEntry[]>(() => {
  const topIndex = stackEntries.value.findIndex((entry) => {
    return isSameImage(entry.image, props.image)
  })
  const ordered = topIndex > 0
    ? [
      ...stackEntries.value.slice(topIndex),
      ...stackEntries.value.slice(0, topIndex),
    ]
    : stackEntries.value

  return ordered.slice(0, STACK_LAYERS_MAX)
})

const hiddenCount = computed<number>(() => {
  return Math.max(0, stackEntries.value.length - STACK_LAYERS_MAX)
})

const stackSizeClass = computed<string>(() => {
  return props.size === 'sm' ? 'h-6 w-8' : 'h-8 w-10'
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

  const topImage = isStacked.value
    ? stackLayers.value[0]?.image ?? props.image
    : props.image
  const index = previewEntries.value.findIndex((entry) => {
    return isSameImage(entry.image, topImage)
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

function onLayerError(url: string) {
  failedLayerUrls[url] = true
}

function onImageError() {
  hasLoadError.value = true

  const current = previewEntry.value

  if (current && isSameImage(current.image, props.image)) {
    isPreviewOpen.value = false
  }
}
</script>
