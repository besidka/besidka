<template>
  <ClientOnly>
    <LazyLandingVideoPlayer
      :src="resolvedSrc"
      :poster="resolvedPoster"
      :caption="resolvedCaption"
      :qualities="video.qualities ?? []"
      :captions="video.captions ?? []"
      :markers="video.markers ?? []"
      :thumbnails="video.thumbnails ?? true"
    />

    <template #fallback>
      <div class="w-full">
        <div
          class="skeleton skeleton--default w-full aspect-video rounded-2xl"
        />
        <p
          v-if="resolvedCaption"
          class="text-sm text-base-content/60 text-center mt-3"
        >
          {{ resolvedCaption }}
        </p>
      </div>
    </template>
  </ClientOnly>
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
