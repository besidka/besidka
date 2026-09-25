<template>
  <section
    v-if="isRenderable"
    class="mt-2 max-w-full"
    :class="isFailure ? 'w-full' : 'w-80'"
    aria-live="polite"
    data-testid="generated-image"
  >
    <div
      v-if="isFailure"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="generated-image-error"
    >
      <Icon name="lucide:image-off" size="18" class="shrink-0" />
      <div>
        <p class="font-medium">Image generation failed</p>
        <p class="text-sm">{{ failureText }}</p>
      </div>
    </div>

    <div
      v-else-if="cardDisplay"
      class="rounded-box border border-base-300 bg-base-200"
      data-testid="generated-image-ready"
    >
      <button
        type="button"
        class="relative block w-full cursor-zoom-in overflow-hidden rounded-t-box bg-base-300 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        :class="{ 'pointer-events-none': isImagePreviewSuppressed }"
        :style="{ aspectRatio: imageAspectRatio }"
        :disabled="hasImageLoadError"
        :aria-label="`Preview ${cardDisplay.name}`"
        data-testid="generated-image-preview-trigger"
        @click="openImagePreview"
      >
        <span
          v-if="!isImageLoaded && !hasImageLoadError"
          class="skeleton skeleton--default absolute inset-0"
        />
        <img
          v-show="!hasImageLoadError"
          :src="imageUrl"
          :alt="cardDisplay.name"
          class="generated-image relative size-full object-contain"
          :class="{
            'generated-image--loaded': isImageLoaded,
          }"
          loading="lazy"
          @load="onImageLoad"
          @error="onImageError"
        >
        <span
          v-if="hasImageLoadError"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-base-content/60"
          role="status"
          data-testid="generated-image-preview-error"
        >
          <Icon name="lucide:image-off" size="32" />
          <span class="text-sm">Image preview unavailable</span>
        </span>
      </button>
      <div class="flex items-center gap-3 p-3">
        <div class="min-w-0 grow">
          <p class="truncate text-sm font-medium" :title="cardDisplay.name">
            {{ cardDisplay.name }}
          </p>
          <p class="text-xs text-base-content/60">
            {{ metaLabel }}
          </p>
        </div>
        <span
          v-if="hasImageLoadError"
          class="badge badge-ghost"
          role="status"
          data-testid="generated-image-actions-unavailable"
        >
          Unavailable
        </span>
        <template v-else>
          <UiButton
            icon-only
            circle
            ghost
            mode="default"
            class="hitslop"
            size="xs"
            tooltip-position="top"
            icon-name="lucide:maximize-2"
            :icon-size="12"
            :title="`Preview ${cardDisplay.name}`"
            data-testid="generated-image-open"
            @click="openImagePreview"
          />
          <UiButton
            v-if="isImageInputSupported && readyToolFile"
            icon-only
            circle
            ghost
            mode="default"
            class="hitslop"
            size="xs"
            tooltip-position="top"
            icon-name="lucide:paperclip"
            :icon-size="12"
            :title="`Attach ${cardDisplay.name} for next prompt`"
            data-testid="generated-image-attach"
            @click="attachForNextPrompt"
          />
          <div
            class="tooltip tooltip-top tooltip-accent before:font-normal before:hidden after:hidden md:before:block md:after:block"
            data-tip="Download"
          >
            <a
              :href="downloadUrl"
              :download="cardDisplay.isInlineData ? cardDisplay.name : null"
              class="btn btn-xs btn-circle btn-accent hitslop"
              :aria-label="`Download ${cardDisplay.name}`"
              data-testid="generated-image-download"
            >
              <Icon name="lucide:download" size="12" />
            </a>
          </div>
        </template>
      </div>
      <LazyChatImagePreview
        v-if="isImagePreviewOpen && !hasImageLoadError"
        v-model:open="isImagePreviewOpen"
        :src="imageUrl"
        :download-url="downloadUrl"
        :alt="cardDisplay.name"
        :filename="cardDisplay.name"
      />
    </div>

    <div
      v-else
      class="relative overflow-hidden rounded-box border border-base-300 bg-base-200"
      :style="{ aspectRatio: imageAspectRatio }"
      role="status"
      data-testid="generated-image-progress"
    >
      <div class="skeleton skeleton--default absolute inset-0" />
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-200/50"
      >
        <span class="loading loading-spinner loading-md text-accent" />
        <div class="text-center">
          <p class="text-sm font-medium">{{ progressLabel }}</p>
          <p class="mt-1 text-xs text-base-content/60">
            This can take a little while
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { FileUIPart, UIMessage } from 'ai'
import type {
  GeneratedImageFile,
} from '#shared/types/image-generation.d'
import {
  getGenerateImageOutput,
  getGenerateImageToolPart,
  getImageGenerationFailureText,
  isAssistantGeneratedImageFilePart,
  resolveAssistantGeneratedImageDisplay,
} from '~/utils/generated-images'

const { messageRole, part } = defineProps<{
  messageRole: UIMessage['role']
  part: UIMessage['parts'][number]
}>()

const { isSuppressed: isImagePreviewSuppressed } = useImagePreviewGuard()
const { isImageInputSupported } = useImageInputSupport()

const isImageLoaded = shallowRef<boolean>(false)
const hasImageLoadError = shallowRef<boolean>(false)
const isImagePreviewOpen = shallowRef<boolean>(false)
const supportedAspectRatios: Record<string, string> = {
  '1:1': '1 / 1',
  '2:3': '2 / 3',
  '3:2': '3 / 2',
}

// A gateway `file` part carries no `generate_image` tool input, so it has
// no curated `aspectRatio` to read the way a direct-provider card does —
// only the loaded image itself knows its real dimensions. Filled in by the
// preview `<img>`'s own `load` event, this keeps the card's fixed `1 / 1`
// fallback (matching the direct-provider default, and avoiding a layout
// jump before the image has loaded) until the true ratio is known, then
// swaps the container over to it so a landscape/portrait image is never
// letterboxed inside a square frame.
const naturalImageAspectRatio = shallowRef<string | null>(null)

const toolPart = computed(() => {
  return getGenerateImageToolPart(part)
})

const imageAspectRatio = computed<string>(() => {
  const inputValue = toolPart.value?.input

  if (inputValue && typeof inputValue === 'object') {
    const aspectRatio = (inputValue as { aspectRatio?: unknown }).aspectRatio

    if (typeof aspectRatio === 'string') {
      return supportedAspectRatios[aspectRatio] || '1 / 1'
    }
  }

  return naturalImageAspectRatio.value || '1 / 1'
})

const output = computed(() => {
  return getGenerateImageOutput(part)
})

const readyToolFile = computed<GeneratedImageFile | null>(() => {
  if (output.value?.status !== 'ready' || !output.value.file) {
    return null
  }

  return output.value.file
})

const assistantFilePart = computed<FileUIPart | null>(() => {
  return isAssistantGeneratedImageFilePart({ role: messageRole }, part)
    ? part as FileUIPart
    : null
})

const assistantFileDisplay = computed(() => {
  const filePart = assistantFilePart.value

  return filePart ? resolveAssistantGeneratedImageDisplay(filePart) : null
})

const isAssistantFileFailure = computed<boolean>(() => {
  return assistantFilePart.value !== null
    && assistantFileDisplay.value === null
})

interface GeneratedImageCardDisplay {
  name: string
  size: number | null
  imageUrl: string
  downloadUrl: string
  isInlineData: boolean
}

const cardDisplay = computed<GeneratedImageCardDisplay | null>(() => {
  const toolFile = readyToolFile.value

  if (toolFile) {
    return {
      name: toolFile.name,
      size: toolFile.size,
      imageUrl: getFileUrl(toolFile.storageKey),
      downloadUrl: getFileDownloadUrl(toolFile.storageKey),
      isInlineData: false,
    }
  }

  const fileDisplay = assistantFileDisplay.value

  if (!fileDisplay) {
    return null
  }

  return {
    name: fileDisplay.name,
    size: null,
    imageUrl: fileDisplay.imageUrl,
    downloadUrl: fileDisplay.downloadUrl,
    isInlineData: fileDisplay.imageUrl.startsWith('data:'),
  }
})

const isRenderable = computed<boolean>(() => {
  if (messageRole !== 'assistant') {
    return false
  }

  if (assistantFilePart.value) {
    return true
  }

  if (toolPart.value?.state === 'output-error') {
    return true
  }

  if (
    toolPart.value?.state === 'input-streaming'
    || toolPart.value?.state === 'input-available'
  ) {
    return true
  }

  return output.value !== null
})

const imageUrl = computed<string>(() => {
  return cardDisplay.value?.imageUrl ?? ''
})

const downloadUrl = computed<string>(() => {
  return cardDisplay.value?.downloadUrl ?? ''
})

const isFailure = computed<boolean>(() => {
  if (assistantFilePart.value) {
    return isAssistantFileFailure.value
  }

  return toolPart.value?.state === 'output-error'
})

const failureText = computed<string>(() => {
  return getImageGenerationFailureText(toolPart.value?.errorText)
})

const progressLabel = computed<string>(() => {
  if (output.value?.status === 'saving') {
    return 'Saving to your files...'
  }

  if (output.value?.status === 'generating') {
    return 'Generating your image...'
  }

  return 'Preparing image generation...'
})

const providerLabel = computed<string>(() => {
  if (output.value?.status !== 'ready') {
    return 'AI'
  }

  if (output.value.provider === 'openai') {
    return 'OpenAI'
  }

  if (output.value.provider === 'google') {
    return 'Google AI'
  }

  return 'AI'
})

const metaLabel = computed<string>(() => {
  const size = cardDisplay.value?.size

  if (size === null || size === undefined) {
    return providerLabel.value
  }

  return `${providerLabel.value} · ${formatFileSize(size)}`
})

function onImageLoad(event: Event) {
  isImageLoaded.value = true

  if (toolPart.value) {
    return
  }

  const image = event.target as HTMLImageElement

  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    naturalImageAspectRatio.value
      = `${image.naturalWidth} / ${image.naturalHeight}`
  }
}

function onImageError() {
  isImageLoaded.value = false
  hasImageLoadError.value = true
  isImagePreviewOpen.value = false
}

function openImagePreview() {
  if (isImagePreviewSuppressed.value) return

  isImagePreviewOpen.value = true
}

function attachForNextPrompt() {
  if (!readyToolFile.value) {
    return
  }

  useNuxtApp().callHook('chat:attach-file', {
    id: readyToolFile.value.id,
    storageKey: readyToolFile.value.storageKey,
    name: readyToolFile.value.name,
    size: readyToolFile.value.size,
    type: readyToolFile.value.type,
  })
}

watch(imageUrl, () => {
  isImageLoaded.value = false
  hasImageLoadError.value = false
  isImagePreviewOpen.value = false
  naturalImageAspectRatio.value = null
}, { flush: 'post' })
</script>

<style scoped>
.generated-image {
  filter: blur(1rem);
  opacity: 0;
  transform: scale(1.02);
  transition:
    filter 400ms ease,
    opacity 300ms ease,
    transform 400ms ease;
}

.generated-image--loaded {
  filter: blur(0);
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .generated-image {
    transition: none;
  }
}
</style>
