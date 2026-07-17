<template>
  <div
    class="
      grid grid-cols-2 gap-2
      md:grid-cols-3
    "
  >
    <LandingStatCard
      v-for="(item, index) in metrics"
      :key="index"
      :class="{ 'max-md:col-span-2': isFullWidthCard(index) }"
      :metric="item.metric"
      :label="item.label"
      :icon="item.icon"
      :format="item.format"
    />
  </div>
</template>

<script setup lang="ts">
import type { AsyncData } from 'nuxt/app'
import type { StatMetric } from '#shared/types/landing.d'

export type InjectedStats = {
  data: AsyncData<unknown, unknown>['data']
  pending: AsyncData<unknown, unknown>['pending']
}

const props = withDefaults(defineProps<{
  metrics: {
    metric: StatMetric
    label: string
    icon?: string
    format?: 'compact' | 'full'
  }[]
}>(), {})

function isFullWidthCard(index: number): boolean {
  return index === props.metrics.length - 1
    && props.metrics.length % 2 === 1
}

const { data, pending } = await useLazyFetch('/api/v1/stats', {
  query: { v: 'image-generation-1' },
})

provide<InjectedStats>('stat-grid-data', { data, pending })
</script>
