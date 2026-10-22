<template>
  <div
    ref="rootRef"
    class="w-full"
  >
    <LazyLandingVideoPlayer
      v-if="isNearViewport"
      :src="resolvedSrc"
      :poster="resolvedPoster"
      :caption="resolvedCaption"
      :qualities="video.qualities ?? []"
      :captions="video.captions ?? []"
      :markers="video.markers ?? []"
      :thumbnails="video.thumbnails ?? true"
    />

    <div
      v-else
      class="w-full"
    >
      <img
        v-if="resolvedPoster"
        :src="resolvedPoster"
        alt=""
        width="1920"
        height="1080"
        loading="lazy"
        decoding="async"
        class="w-full aspect-video rounded-2xl object-contain bg-base-300
          ring-1 ring-base-content/10 shadow-xl"
      >
      <div
        v-else
        class="skeleton skeleton--default w-full aspect-video rounded-2xl"
      />
      <p
        v-if="resolvedCaption"
        class="text-sm text-base-content/60 text-center mt-3"
      >
        {{ resolvedCaption }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'
import type { VideoData } from '#shared/types/video.d'

const props = withDefaults(defineProps<{
  src?: string
  poster?: string
  caption?: string
}>(), {
  src: undefined,
  poster: undefined,
  caption: undefined,
})

const VIEWPORT_ROOT_MARGIN = '300px'

const rootRef = shallowRef<HTMLElement | null>(null)
const isNearViewport = shallowRef<boolean>(false)

const { stop: stopObserving } = useIntersectionObserver(
  rootRef,
  ([entry]) => {
    if (!entry?.isIntersecting) {
      return
    }

    isNearViewport.value = true
    stopObserving()
  },
  {
    root: () => {
      return rootRef.value?.closest('.js-page-content') ?? null
    },
    rootMargin: VIEWPORT_ROOT_MARGIN,
  },
)

const data = inject<MaybeRefOrGetter<{ video?: VideoData }>>(
  'home:data',
  {},
)

const video = computed<VideoData>(() => {
  return toValue(data)?.video ?? {}
})

const resolvedSrc = computed<string>(() => {
  if (props.src) {
    return props.src
  }

  return video.value.src ?? '/videos/demo.mp4'
})

const resolvedPoster = computed<string | undefined>(() => {
  if (props.poster) {
    return props.poster
  }

  return video.value.poster
})

const resolvedCaption = computed<string | undefined>(() => {
  if (props.caption) {
    return props.caption
  }

  return video.value.caption
})
</script>
