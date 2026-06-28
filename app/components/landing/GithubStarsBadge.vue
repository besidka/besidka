<template>
  <a
    :href="`https://github.com/${props.repo}`"
    target="_blank"
    rel="noopener noreferrer"
    class="btn btn-ghost btn-xs rounded-full"
    :aria-label="`${formattedStars} stars on GitHub for ${props.repo}`"
    @click="track('github_click', { target: 'stars-badge' })"
  >
    <Icon
      name="lucide:star"
      size="16"
      aria-hidden="true"
    />
    <span
      v-if="pending"
      class="skeleton skeleton--default h-4 w-8 rounded"
    />
    <span v-else class="tabular-nums font-medium">{{ formattedStars }}</span>
    <span v-if="showLabel">stars on GitHub</span>
    <span class="sr-only">(opens in new tab)</span>
  </a>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  repo?: string
  showLabel?: boolean
}>(), {
  repo: 'besidka/besidka',
  showLabel: true,
})

const { track } = useLandingAnalytics()

const { data, pending } = await useGithubStars()

const starsCount = computed<number>(() => {
  if (!data.value) {
    return 0
  }

  const value = (data.value as Record<string, unknown>).stars

  return typeof value === 'number' ? value : 0
})

const formattedStars = computed<string>(() => {
  return formatCompactNumber(starsCount.value)
})
</script>
