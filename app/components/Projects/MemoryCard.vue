<template>
  <UiBubble class="mb-4 !block bg-base-100 dark:bg-base-100/10 shadow-none">
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
        v-if="displayStatusBadge"
        class="badge badge-ghost badge-sm shrink-0"
        :class="statusBadgeClass"
      >
        {{ statusLabel }}
      </div>
    </div>

    <div class="mt-4 rounded-box border border-base-200/80 px-4 py-3">
      <p
        v-if="displayMemory"
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
        <p v-if="providerLabel">
          {{ providerLabel }}
        </p>
        <p v-if="updatedLabel">
          {{ updatedLabel }}
        </p>
        <p v-if="error">
          {{ error }}
        </p>
      </div>
      <div class="max-sm:grid max-sm:w-full sm:flex sm:flex-row-reverse sm:items-center gap-2">
        <button
          v-if="displayRefreshButton"
          type="button"
          data-testid="refresh-project-memory"
          class="btn btn-primary btn-sm max-sm:btn-block max-sm:order-1"
          :disabled="isRefreshing || isToggling"
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
        <button
          type="button"
          data-testid="toggle-project-memory"
          class="btn btn-sm max-sm:btn-block max-sm:order-2"
          :class="props.memoryStatus === 'disabled'
            ? 'btn-primary'
            : 'btn-ghost'
          "
          :disabled="isRefreshing || isToggling"
          @click="emit('toggle')"
        >
          <span
            v-if="isToggling"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>
            {{ props.memoryStatus === 'disabled'
              ? 'Enable memory'
              : 'Disable memory'
            }}
          </span>
        </button>
      </div>
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
  isToggling: boolean
}>()

const emit = defineEmits<{
  refresh: []
  toggle: []
}>()

const statusLabel = computed(() => {
  switch (props.memoryStatus) {
    case 'refreshing':
      return 'Refreshing'
    case 'stale':
      return 'Stale'
    case 'failed':
      return 'Failed'
    case 'unavailable':
      return 'Unavailable'
    case 'disabled':
      return 'Disabled'
    default:
      return 'Empty'
  }
})

const statusBadgeClass = computed(() => {
  switch (props.memoryStatus) {
    case 'refreshing':
      return 'badge-info badge-outline'
    case 'stale':
      return 'badge-warning badge-outline'
    case 'failed':
      return 'badge-error badge-outline'
    case 'unavailable':
      return 'badge-ghost'
    case 'disabled':
      return 'badge-ghost'
    default:
      return ''
  }
})

const displayStatusBadge = computed(() => {
  return props.memoryStatus !== 'ready'
})

const displayMemory = computed(() => {
  return props.memoryStatus !== 'disabled' && !!props.memory
})

const displayRefreshButton = computed(() => {
  return props.memoryStatus !== 'disabled'
})

const providerLabel = computed(() => {
  if (!props.memory || !props.memoryProvider || !props.memoryModel) {
    return null
  }

  return `Model: ${props.memoryProvider} / ${props.memoryModel}`
})

const updatedLabel = computed(() => {
  if (!props.memory || !props.memoryUpdatedAt) {
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

  if (props.memoryStatus === 'disabled') {
    return 'Project memory is disabled for this project.'
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

  return 'No reusable project memory was found. For instruction-only '
    + 'projects or unrelated chats, keeping memory disabled is often better.'
})
</script>
