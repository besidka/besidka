<template>
  <div v-if="resolvedComparison" class="flex flex-col gap-4">
    <LandingComparisonTable
      :caption="resolvedComparison.caption"
      :columns="resolvedComparison.columns"
      :rows="resolvedComparison.rows"
    />

    <div class="flex flex-col gap-1">
      <p
        v-if="resolvedComparison.note"
        class="text-sm text-base-content/80 leading-relaxed"
      >
        {{ resolvedComparison.note }}
      </p>
      <p
        v-if="resolvedComparison.priceDate"
        class="text-xs text-base-content/40 mt-1"
      >
        Competitor prices as of {{ resolvedComparison.priceDate }}.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type ComparisonRow = {
  label: string
  values: string[]
}

type ComparisonData = {
  caption?: string
  columns: string[]
  rows: ComparisonRow[]
  note?: string
  priceDate?: string
}

type HomeDataShape = {
  comparison?: ComparisonData | null
}

const data = inject<MaybeRefOrGetter<HomeDataShape>>(
  'home:data',
  {},
)

const resolvedComparison = computed<ComparisonData | null>(() => {
  return toValue(data)?.comparison ?? null
})
</script>
