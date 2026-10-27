<template>
  <button
    type="button"
    class="bubble rounded-box grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 p-3 text-left hover:bg-base-content/5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto_auto]"
    data-testid="memory-entry-row"
    @click="emit('select', entry)"
  >
    <span class="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
      <span
        v-if="label"
        class="badge badge-soft badge-sm shrink-0"
        data-testid="memory-entry-label"
      >
        {{ label }}
      </span>
      <span class="truncate font-medium">{{ entry.title }}</span>
    </span>
    <span
      class="col-span-2 row-start-2 line-clamp-2 min-w-0 text-sm text-base-content/70 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:line-clamp-1"
      data-testid="memory-entry-description"
    >
      {{ entry.description }}
    </span>
    <span
      class="col-span-2 row-start-3 justify-self-end whitespace-nowrap text-xs text-base-content/60 sm:col-span-1 sm:col-start-3 sm:row-start-1"
      data-testid="memory-entry-meta"
    >
      {{ metaLabel }}
    </span>
    <Icon
      name="lucide:chevron-right"
      size="16"
      class="col-start-2 row-start-1 shrink-0 sm:col-start-4"
    />
  </button>
</template>

<script setup lang="ts">
import type { MemoryEntry } from '#shared/types/memory.d'

const props = defineProps<{
  entry: MemoryEntry
  label?: string | null
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
}>()

const metaLabel = computed<string>(() => {
  const age = formatMemoryUpdatedAge(new Date(props.entry.updatedAt))

  return `Updated ${age}`
})
</script>
