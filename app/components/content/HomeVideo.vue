<template>
  <LandingDemoVideo
    :src="resolvedSrc"
    :poster="resolvedPoster"
    :caption="resolvedCaption"
  />
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type VideoData = {
  src?: string
  poster?: string
  caption?: string
}

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

const resolvedSrc = computed<string>(() => {
  if (props.src) {
    return props.src
  }

  return toValue(data)?.video?.src ?? '/videos/demo.mp4'
})

const resolvedPoster = computed<string | undefined>(() => {
  if (props.poster) {
    return props.poster
  }

  return toValue(data)?.video?.poster ?? undefined
})

const resolvedCaption = computed<string | undefined>(() => {
  if (props.caption) {
    return props.caption
  }

  return toValue(data)?.video?.caption ?? undefined
})
</script>
