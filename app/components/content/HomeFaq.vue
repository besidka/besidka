<template>
  <LandingFaqAccordion :items="resolvedItems" group-name="home-faq" />
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type FaqItem = { question: string, answer: string }

const props = withDefaults(defineProps<{
  items?: FaqItem[]
}>(), {
  items: () => [],
})

const data = inject<MaybeRefOrGetter<{ faqs?: FaqItem[] }>>('home:data', {})

const resolvedItems = computed<FaqItem[]>(() => {
  if (props.items.length) {
    return props.items
  }

  return toValue(data)?.faqs ?? []
})
</script>
