<template>
  <div
    v-if="formattedTimestamp"
    class="w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24"
  >
    <p
      class="mt-1 text-xs text-base-content/40"
      :class="{
        'text-right': role === 'user',
        'text-left': role !== 'user',
      }"
    >
      <time :datetime="isoTimestamp">{{ formattedTimestamp }}</time>
    </p>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'

const props = defineProps<{
  role: UIMessage['role']
  createdAt?: string | number
}>()

const timestamp = computed<Date | null>(() => {
  if (!props.createdAt) {
    return null
  }

  const date = new Date(props.createdAt)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
})

const isoTimestamp = computed<string>(() => {
  return timestamp.value?.toISOString() || ''
})

const formattedTimestamp = computed<string>(() => {
  if (!timestamp.value) {
    return ''
  }

  return timestamp.value.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
})
</script>
