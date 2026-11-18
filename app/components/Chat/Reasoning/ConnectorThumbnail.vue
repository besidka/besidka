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
      v-if="isPreviewOpen && links"
      v-model:open="isPreviewOpen"
      :src="links.openUrl"
      :download-url="links.downloadUrl"
      :alt="alt"
      :filename="image.name"
    />
  </span>
</template>

<script setup lang="ts">
import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'

const props = withDefaults(defineProps<{
  image: ConnectorImagePartData
  alt: string
  size?: 'sm' | 'md'
  extraCount?: number
}>(), {
  size: 'md',
  extraCount: 0,
})

const { isSuppressed: isImagePreviewSuppressed } = useImagePreviewGuard()
const isPreviewOpen = shallowRef<boolean>(false)
const hasLoadError = shallowRef<boolean>(false)

const links = computed(() => getSafeFileLinks(props.image.url))

const isUnavailable = computed<boolean>(() => {
  return !!props.image.deleted || hasLoadError.value || !links.value
})

const sizeClass = computed<string>(() => {
  return props.size === 'sm' ? 'size-6' : 'size-8'
})

function openPreview() {
  if (isImagePreviewSuppressed.value || !links.value) {
    return
  }

  isPreviewOpen.value = true
}

function onImageError() {
  hasLoadError.value = true
  isPreviewOpen.value = false
}
</script>
