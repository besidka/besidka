<template>
  <LandingCarousel
    :items="resolvedItems"
    aspect-ratio="video"
    :autoplay="true"
    :interval-ms="5500"
  />
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type CarouselItem = { src: string, alt: string, caption?: string }

const props = withDefaults(defineProps<{
  items?: CarouselItem[]
}>(), {
  items: () => [],
})

const data = inject<MaybeRefOrGetter<{ carousel?: CarouselItem[] }>>(
  'home:data',
  {},
)

const resolvedItems = computed<CarouselItem[]>(() => {
  if (props.items.length) {
    return props.items
  }

  return toValue(data)?.carousel ?? []
})
</script>
