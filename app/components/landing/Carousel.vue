<template>
  <div
    class="relative w-full"
    aria-roledescription="carousel"
    :aria-label="ariaLabel"
  >
    <span
      aria-live="polite"
      aria-atomic="true"
      class="sr-only"
    >
      {{ liveAnnouncement }}
    </span>

    <div
      ref="slidesRegion"
      class="overflow-hidden w-full"
    >
      <div
        class="flex transition-transform duration-300 motion-reduce:transition-none"
        :style="{ transform: `translateX(-${activeIndex * 100}%)` }"
      >
        <div
          v-for="(item, index) in items"
          :key="index"
          class="shrink-0 w-full p-1"
          role="group"
          aria-roledescription="slide"
          :aria-label="`Slide ${index + 1} of ${items.length}`"
          :inert="index !== activeIndex"
        >
          <button
            type="button"
            class="w-full block cursor-zoom-in rounded-2xl
              overflow-hidden bg-base-200
              focus-visible:outline-2 focus-visible:outline-primary
              focus-visible:outline-offset-2 relative"
            :aria-label="`Enlarge image: ${item.alt}`"
            @click="openLightbox(index)"
          >
            <span
              v-if="index === activeIndex"
              class="
                absolute z-10 bottom-2 right-2
                flex items-center justify-center size-8 p-1
                bg-base-100/70 rounded-full pointer-events-none
              "
              aria-hidden="true"
            >
              <Icon name="lucide:zoom-in" class="size-4" aria-hidden="true" />
            </span>
            <div
              class="aspect-video w-full flex items-center justify-center"
            >
              <img
                :src="item.src"
                :alt="item.alt"
                class="w-full h-full object-contain"
                loading="lazy"
                decoding="async"
              >
            </div>
          </button>
          <p
            v-if="item.caption"
            class="mt-2 text-sm text-center text-base-content/60"
          >
            {{ item.caption }}
          </p>
        </div>
      </div>
    </div>

    <div
      class="flex items-center justify-center gap-3 mt-4"
      role="group"
      :aria-label="`${ariaLabel} controls`"
    >
      <button
        type="button"
        class="btn btn-sm btn-ghost btn-circle"
        aria-label="Previous slide"
        :aria-disabled="items.length <= 1"
        @click="previous"
        @keydown.left="previous"
        @keydown.right="next"
      >
        <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
      </button>

      <div class="flex gap-1.5" role="group" aria-label="Slide indicators">
        <button
          v-for="(_, index) in items"
          :key="index"
          type="button"
          class="size-2 rounded-full transition-colors"
          :class="{
            'bg-primary': index === activeIndex,
            'bg-base-content/30': index !== activeIndex,
          }"
          :aria-label="`Go to slide ${index + 1}`"
          :aria-current="index === activeIndex ? 'true' : undefined"
          @click="goTo(index)"
        />
      </div>

      <button
        type="button"
        class="btn btn-sm btn-ghost btn-circle"
        aria-label="Next slide"
        :aria-disabled="items.length <= 1"
        @click="next"
        @keydown.left="previous"
        @keydown.right="next"
      >
        <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
      </button>

      <button
        v-if="autoplay"
        type="button"
        class="btn btn-sm btn-ghost btn-circle"
        :aria-label="isPlaying ? 'Pause carousel' : 'Play carousel'"
        @click="togglePlayback"
      >
        <Icon
          :name="isPlaying ? 'lucide:pause' : 'lucide:play'"
          class="size-4"
          aria-hidden="true"
        />
      </button>
    </div>

    <ClientOnly>
      <Teleport to="body">
        <dialog
          ref="lightboxDialog"
          class="modal"
          @close="onLightboxClose"
        >
          <div class="modal-box max-w-5xl w-full p-2 sm:p-4">
            <form method="dialog">
              <button
                class="btn btn-sm btn-circle btn-ghost absolute right-2
                  top-2 z-10"
                aria-label="Close lightbox"
              >
                <Icon name="lucide:x" size="16" aria-hidden="true" />
              </button>
            </form>

            <div
              v-if="lightboxIndex !== null"
              class="flex flex-col items-center"
            >
              <div
                class="aspect-video w-full max-h-[70vh] flex items-center
                  justify-center bg-base-200 rounded-xl"
              >
                <img
                  :src="items[lightboxIndex]?.src"
                  :alt="items[lightboxIndex]?.alt"
                  class="w-full h-full object-contain rounded-xl"
                >
              </div>
              <p
                v-if="items[lightboxIndex]?.caption"
                class="mt-3 text-sm text-center text-base-content/60"
              >
                {{ items[lightboxIndex]?.caption }}
              </p>
            </div>

            <div
              v-if="items.length > 1"
              class="flex items-center justify-center gap-4 mt-4"
            >
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-circle"
                aria-label="Previous image"
                @click="lightboxPrev"
              >
                <Icon
                  name="lucide:chevron-left"
                  size="16"
                  aria-hidden="true"
                />
              </button>
              <span class="text-sm text-base-content/60 tabular-nums">
                {{ (lightboxIndex ?? 0) + 1 }} / {{ items.length }}
              </span>
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-circle"
                aria-label="Next image"
                @click="lightboxNext"
              >
                <Icon
                  name="lucide:chevron-right"
                  size="16"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </Teleport>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  items: { src: string, alt: string, caption?: string }[]
  aspectRatio?: 'video' | 'square' | 'portrait'
  autoplay?: boolean
  intervalMs?: number
  ariaLabel?: string
}>(), {
  aspectRatio: 'video',
  autoplay: false,
  intervalMs: 5000,
  ariaLabel: 'Image carousel',
})

const reducedMotion = usePreferredReducedMotion()
const activeIndex = shallowRef<number>(0)
const isPlaying = shallowRef<boolean>(false)
const wasPlayingBeforeLightbox = shallowRef<boolean>(false)
const isLightboxOpen = shallowRef<boolean>(false)
const lightboxIndex = shallowRef<number | null>(null)
const liveAnnouncement = shallowRef<string>('')

const slidesRegion = useTemplateRef<HTMLDivElement>('slidesRegion')
const lightboxDialog = useTemplateRef<HTMLDialogElement>('lightboxDialog')

let intervalHandle: ReturnType<typeof setInterval> | undefined

function announce(index: number) {
  const item = props.items[index]

  if (!item) {
    return
  }

  const caption = item.caption ? `: ${item.caption}` : ''

  liveAnnouncement.value = `Slide ${index + 1} of ${props.items.length}${caption}`
}

function goTo(index: number) {
  activeIndex.value = (index + props.items.length) % props.items.length
  announce(activeIndex.value)
}

function previous() {
  goTo(activeIndex.value - 1)
}

function next() {
  goTo(activeIndex.value + 1)
}

function shouldAutoplay() {
  return reducedMotion.value !== 'reduce'
    && !document.hidden
}

function startAutoplay() {
  if (!shouldAutoplay()) {
    return
  }

  intervalHandle = setInterval(() => {
    next()
  }, props.intervalMs)

  isPlaying.value = true
}

function stopAutoplay() {
  clearInterval(intervalHandle)
  intervalHandle = undefined
  isPlaying.value = false
}

function togglePlayback() {
  if (isPlaying.value) {
    stopAutoplay()
  } else {
    startAutoplay()
  }
}

async function openLightbox(index: number) {
  lightboxIndex.value = index
  isLightboxOpen.value = true
  wasPlayingBeforeLightbox.value = isPlaying.value
  stopAutoplay()

  await nextTick()
  lightboxDialog.value?.showModal()
}

function onLightboxClose() {
  isLightboxOpen.value = false

  if (props.autoplay && wasPlayingBeforeLightbox.value) {
    startAutoplay()
  }
}

function lightboxPrev() {
  if (lightboxIndex.value === null) {
    return
  }

  lightboxIndex.value = (lightboxIndex.value - 1 + props.items.length)
    % props.items.length
}

function lightboxNext() {
  if (lightboxIndex.value === null) {
    return
  }

  lightboxIndex.value = (lightboxIndex.value + 1) % props.items.length
}

function handleLightboxKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    lightboxPrev()
  } else if (event.key === 'ArrowRight') {
    lightboxNext()
  }
}

function handleVisibilityChange() {
  if (!props.autoplay) {
    return
  }

  if (document.hidden) {
    stopAutoplay()
  } else if (!isLightboxOpen.value) {
    startAutoplay()
  }
}

watch(isLightboxOpen, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', handleLightboxKeydown)
  } else {
    window.removeEventListener('keydown', handleLightboxKeydown)
  }
})

onMounted(() => {
  if (props.autoplay && shouldAutoplay()) {
    startAutoplay()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  stopAutoplay()
  window.removeEventListener('keydown', handleLightboxKeydown)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  if (lightboxDialog.value?.open) {
    lightboxDialog.value.close()
  }
})
</script>
