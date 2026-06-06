<template>
  <div
    class="rounded-2xl p-4 flex flex-col items-start gap-1
      bg-base-100/50 dark:bg-base-content/5"
  >
    <Icon
      v-if="icon"
      :name="icon"
      class="w-4 h-4 text-accent mb-1"
      aria-hidden="true"
    />
    <div
      v-if="isLoading"
      class="skeleton skeleton--default h-7 w-16 rounded-md"
      aria-hidden="true"
    />
    <span
      v-else
      class="text-2xl sm:text-3xl font-bold text-base-content
        tabular-nums leading-none"
      :aria-label="`${formattedValue} ${label}`"
    >
      {{ formattedValue }}
    </span>
    <p class="text-xs sm:text-sm text-base-content/60 leading-snug">
      {{ label }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { InjectedStats } from './StatGrid.vue'

type StatMetric = 'users' | 'chats' | 'messages' | 'files'

const FALLBACK: Record<StatMetric, number> = {
  users: 100,
  chats: 1000,
  messages: 5000,
  files: 100,
}

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
  { immediate: !injectedStats },
)

const isLoading = computed<boolean>(() => {
  if (injectedStats) {
    return injectedStats.data.value === null
  }

  return ownPending.value
})

function isAllZeros(value: unknown) {
  if (!value || typeof value !== 'object') return true

  const record = value as Record<string, unknown>
  const keys: StatMetric[] = ['users', 'chats', 'messages', 'files']

  return keys.every((key) => {
    return typeof record[key] !== 'number' || record[key] === 0
  })
}

const rawValue = computed<number>(() => {
  const source = injectedStats
    ? injectedStats.data.value
    : ownData.value

  if (!source || isAllZeros(source)) {
    return FALLBACK[props.metric]
  }

  const value = (source as Record<string, unknown>)[props.metric]

  if (typeof value !== 'number' || value === 0) {
    return FALLBACK[props.metric]
  }

  return value
})

const formattedValue = computed<string>(() => {
  const value = rawValue.value

  if (props.format === 'compact') {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
    }).format(value)
  }

  return new Intl.NumberFormat('en-US').format(value)
})
</script>
