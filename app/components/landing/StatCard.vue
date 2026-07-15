<template>
  <div
    class="rounded-2xl p-4 flex flex-col items-start gap-1
      bg-base-100/50 dark:bg-base-content/5"
  >
    <div
      v-if="icon"
      class="size-9 rounded-xl bg-base-200 grid place-items-center
        text-accent mb-2"
    >
      <Icon
        :name="icon"
        class="size-5"
        aria-hidden="true"
      />
    </div>
    <div
      v-if="isLoading"
      class="skeleton skeleton--default h-7 w-16 rounded-md"
      aria-hidden="true"
    />
    <span
      v-else
      class="text-xl sm:text-2xl font-bold text-base-content
        tabular-nums leading-none"
      :aria-label="displayValue !== '—'
        ? `${displayValue} ${label}`
        : `${label} unavailable`"
    >
      {{ displayValue }}
    </span>
    <p class="text-xs sm:text-sm text-base-content/60 leading-snug">
      {{ label }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { InjectedStats } from './StatGrid.vue'
import type { StatMetric } from '#shared/types/landing.d'

const props = withDefaults(defineProps<{
  metric: StatMetric
  label: string
  format?: 'compact' | 'full'
  icon?: string
}>(), {
  format: 'compact',
  icon: undefined,
})

const injectedStats = inject<InjectedStats | null>('stat-grid-data', null)

const { data: ownData, pending: ownPending } = await useLazyFetch(
  '/api/v1/stats',
  {
    immediate: !injectedStats,
    query: { v: 3 },
  },
)

const isLoading = computed<boolean>(() => {
  if (injectedStats) {
    return injectedStats.data.value === null
      && injectedStats.pending.value
  }

  return ownPending.value
})

const rawValue = computed<number | null>(() => {
  const source = injectedStats
    ? injectedStats.data.value
    : ownData.value

  if (!source || typeof source !== 'object') {
    return null
  }

  const value = (source as Record<string, unknown>)[props.metric]

  if (typeof value !== 'number') {
    return null
  }

  return value
})

const displayValue = computed<string>(() => {
  if (rawValue.value === null) {
    return '—'
  }

  const value = rawValue.value

  if (props.format === 'compact') {
    return formatCompactNumber(value)
  }

  return new Intl.NumberFormat('en-US').format(value)
})
</script>
