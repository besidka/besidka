<template>
  <LandingFeatureGrid :features="resolvedFeatures" :columns="columns" />
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type Feature = { icon: string, title: string, body: string }

const props = withDefaults(defineProps<{
  set?: 'steps' | 'features'
  features?: Feature[]
  columns?: 2 | 3 | 4
}>(), {
  set: 'features',
  features: () => [],
  columns: 3,
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
