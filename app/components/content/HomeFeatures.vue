<template>
  <LandingFeatureGrid
    :features="resolvedFeatures"
    :columns="resolvedColumns"
  />
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type Feature = { icon: string, title: string, body: string }

// MDC attributes arrive as strings (columns=3 -> "3"), so the prop accepts
// both and is normalized below before reaching the strictly-typed grid.
const props = withDefaults(defineProps<{
  set?: 'steps' | 'features' | 'benefits'
  features?: Feature[]
  columns?: number | string
}>(), {
  set: 'features',
  features: () => [],
  columns: 3,
})

const resolvedColumns = computed<2 | 3 | 4>(() => {
  const value = Number(props.columns)

  if (value === 2 || value === 4) {
    return value
  }

  return 3
})

const data = inject<MaybeRefOrGetter<Record<string, Feature[]>>>(
  'home:data',
  {},
)

const resolvedFeatures = computed<Feature[]>(() => {
  if (props.features.length) {
    return props.features
  }

  return toValue(data)?.[props.set] ?? []
})
</script>
