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
        v-if="priceDateLabel"
        class="text-xs text-base-content/60 mt-1"
        data-testid="landing-comparison-price-date"
      >
        {{ priceDateLabel }}.
      </p>
      <p
        v-if="resolvedComparison.sources?.length"
        class="text-xs text-base-content/60"
        data-testid="landing-comparison-sources"
      >
        Sources:
        <span
          v-for="(source, sourceIndex) in resolvedComparison.sources"
          :key="source.url"
        >
          <a
            v-if="isSafeExternalUrl(source.url)"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            class="link"
          >
            {{ source.label }}
            <span class="sr-only">(opens in new tab)</span>
          </a>
          <template v-else>
            {{ source.label }}
          </template>{{ getSourceSeparator(sourceIndex) }}
        </span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'
import type { ComparisonData } from '#shared/types/landing.d'
import { isSafeExternalUrl } from '#shared/utils/external-url'

type HomeDataShape = {
  comparison?: ComparisonData | null
}

const data = inject<MaybeRefOrGetter<HomeDataShape>>(
  'home:data',
  {},
)

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const resolvedComparison = computed<ComparisonData | null>(() => {
  return toValue(data)?.comparison ?? null
})

function getSourceSeparator(sourceIndex: number): string {
  const sourcesCount = resolvedComparison.value?.sources?.length ?? 0

  return sourceIndex < sourcesCount - 1 ? ', ' : '.'
}

const priceDateLabel = computed<string>(() => {
  const priceDate = resolvedComparison.value?.priceDate

  if (!priceDate) {
    return ''
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(priceDate)
  const monthName = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined

  if (!match || !monthName) {
    return `Checked ${priceDate}`
  }

  return `Checked ${Number(match[3])} ${monthName} ${match[1]}`
})
</script>
