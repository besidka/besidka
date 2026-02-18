<template>
  <div class="mb-3">
    <template v-if="!stats && !hasLoadError">
      <div class="flex items-center justify-between text-sm mb-3">
        <span class="skeleton h-4 w-24" />
        <span class="skeleton h-4 w-30" />
      </div>
      <div class="skeleton h-2 w-full" />
    </template>
    <template v-else-if="hasLoadError">
      <p class="text-xs text-base-content/60">
        Storage stats are temporarily unavailable
      </p>
    </template>
    <template v-else-if="stats">
      <div class="flex items-center justify-between text-sm mb-1">
        <span class="text-base-content/70">Storage used</span>
        <span
          class="font-medium"
          :class="{
            'text-error': stats.percentage >= 90,
            'text-warning': stats.percentage >= 70 && stats.percentage < 90,
          }"
        >
          {{ formatFileSize(stats.used) }}
          / {{ formatFileSize(stats.total) }}
        </span>
      </div>
      <progress
        class="progress w-full"
        :class="{
          'progress-error': stats.percentage >= 90,
          'progress-warning': stats.percentage >= 70
            && stats.percentage < 90,
          'progress-primary-content': stats.percentage < 70,
        }"
        :value="stats.percentage"
        max="100"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
const { data: stats, error, refresh } = useLazyFetch('/api/v1/storage')
const hasLoadError = shallowRef<boolean>(false)

watch(error, (value) => {
  hasLoadError.value = !!value
}, {
  immediate: true,
  flush: 'post',
})

const nuxtApp = useNuxtApp()

nuxtApp.hook('files:uploaded', refresh)

defineExpose({
  fetch: refresh,
})
</script>
