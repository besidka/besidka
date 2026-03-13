<template>
  <UiBubble class="mb-4 !block">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          Project memory
        </h2>
        <p class="mt-1 text-sm opacity-70">
          Durable context synthesized from chats currently assigned to this
          project.
        </p>
      </div>
      <div
        class="badge badge-ghost badge-sm shrink-0"
        :class="statusBadgeClass"
      >
        {{ statusLabel }}
      </div>
    </div>

    <div class="mt-4 rounded-box border border-base-200/80 px-4 py-3">
      <p
        v-if="memory"
        class="whitespace-pre-wrap text-sm leading-6"
      >
        {{ memory }}
      </p>
      <p
        v-else
        class="text-sm opacity-60"
      >
        {{ emptyStateLabel }}
      </p>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div class="text-xs opacity-60">
        <span v-if="providerLabel">
          {{ providerLabel }}
        </span>
        <span v-if="updatedLabel">
          {{ providerLabel ? ' • ' : '' }}{{ updatedLabel }}
        </span>
        <span v-if="error">
          {{ (providerLabel || updatedLabel) ? ' • ' : '' }}{{ error }}
        </span>
      </div>
      <button
        type="button"
        data-testid="refresh-project-memory"
        class="btn btn-secondary btn-sm"
        :disabled="isRefreshing"
        @click="emit('refresh')"
      >
        <span
          v-if="isRefreshing"
          class="loading loading-spinner loading-xs"
        />
        <span v-else>
          Refresh memory
        </span>
      </button>
    </div>
  </UiBubble>
</template>

<script setup lang="ts">
import type { ProjectMemoryStatus } from '#shared/types/projects.d'

const props = defineProps<{
  memory: string | null
  memoryStatus: ProjectMemoryStatus
  memoryUpdatedAt: string | null
  memoryProvider: string | null
  memoryModel: string | null
  memoryError: string | null
  isRefreshing: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const statusLabel = computed(() => {
  switch (props.memoryStatus) {
    case 'ready':
      return 'Ready'
    case 'refreshing':
      return 'Refreshing'
    case 'stale':
      return 'Stale'
    case 'failed':
      return 'Failed'
    case 'unavailable':
      return 'Unavailable'
    default:
      return 'Idle'
  }
})

const statusBadgeClass = computed(() => {
  switch (props.memoryStatus) {
    case 'ready':
      return 'badge-success badge-outline'
    case 'refreshing':
      return 'badge-info badge-outline'
    case 'stale':
      return 'badge-warning badge-outline'
    case 'failed':
      return 'badge-error badge-outline'
    case 'unavailable':
      return 'badge-ghost'
    default:
      return ''
  }
})

const providerLabel = computed(() => {
  if (!props.memoryProvider || !props.memoryModel) {
    return null
  }

  return `Model: ${props.memoryProvider} / ${props.memoryModel}`
})

const updatedLabel = computed(() => {
  if (!props.memoryUpdatedAt) {
    return null
  }

  return `Updated ${formatActivityAge(new Date(props.memoryUpdatedAt))}`
})

const error = computed(() => {
  return props.memoryError?.trim() || null
})

const emptyStateLabel = computed(() => {
  if (props.memoryStatus === 'unavailable') {
    return 'Add a supported API key to generate project memory.'
  }

  if (props.memoryStatus === 'refreshing') {
    return 'Refreshing project memory.'
  }

  if (props.memoryStatus === 'failed') {
    return 'Project memory refresh failed.'
  }

  if (props.memoryStatus === 'stale') {
    return 'Project memory needs a refresh.'
  }

  return 'No project memory yet.'
})
</script>
