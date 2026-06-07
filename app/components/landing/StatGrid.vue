<template>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
    <LandingStatCard
      v-for="(item, index) in metrics"
      :key="index"
      :metric="item.metric"
      :label="item.label"
      :icon="item.icon"
      :format="item.format"
    />
  </div>
</template>

<script setup lang="ts">
import type { AsyncData } from 'nuxt/app'

export type InjectedStats = {
  data: AsyncData<unknown, unknown>['data']
  pending: AsyncData<unknown, unknown>['pending']
}

type StatMetric = 'users' | 'chats' | 'messages' | 'files'

withDefaults(defineProps<{
  metrics: {
    metric: StatMetric
    label: string
    icon?: string
    format?: 'compact' | 'full'
  }[]
}>(), {})

const { data, pending } = await useLazyFetch('/api/v1/stats')

provide<InjectedStats>('stat-grid-data', { data, pending })
</script>
