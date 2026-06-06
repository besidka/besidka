<template>
  <a
    :href="`https://github.com/${repoName}`"
    target="_blank"
    rel="noopener noreferrer"
    class="badge badge-soft gap-1.5 no-underline"
    :aria-label="`${formattedStars} stars on GitHub for ${repoName}`"
  >
    <Icon
      name="lucide:star"
      class="size-4 text-accent"
      aria-hidden="true"
    />
    <span
      v-if="pending"
      class="skeleton skeleton--default h-4 w-8 rounded"
    />
    <span v-else class="tabular-nums font-medium">{{ formattedStars }}</span>
    <span v-if="showLabel" class="text-base-content/70">stars on GitHub</span>
  </a>
</template>

<script setup lang="ts">
const FALLBACK_STARS = 0

const props = withDefaults(defineProps<{
  repo?: string
  showLabel?: boolean
}>(), {
  repo: 'besidka/besidka',
  showLabel: true,
})

const repoName = computed<string>(() => props.repo ?? 'besidka/besidka')

const { data, pending } = await useLazyFetch('/api/v1/github/stars')

const starsCount = computed<number>(() => {
  if (!data.value) {
    return FALLBACK_STARS
  }

  const value = (data.value as Record<string, unknown>).stars

  return typeof value === 'number' ? value : FALLBACK_STARS
})

const formattedStars = computed<string>(() => {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
  }).format(starsCount.value)
})
</script>
