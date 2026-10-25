<template>
  <button
    type="button"
    class="bubble flex w-full items-center justify-between gap-4 p-4 text-left hover:opacity-80"
    data-testid="memory-entry-row"
    @click="emit('select', entry)"
  >
    <span class="grid min-w-0 gap-1">
      <span class="truncate font-bold">{{ entry.title }}</span>
      <span class="line-clamp-1 text-sm text-base-content/70">
        {{ entry.description }}
      </span>
      <span
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60"
      >
        <span data-testid="memory-entry-meta">{{ metaLabel }}</span>
        <span
          v-if="isSensitive"
          class="badge badge-soft badge-warning badge-sm gap-1"
          data-testid="memory-entry-sensitive"
        >
          <Icon name="lucide:shield-alert" size="12" />
          Sensitive
        </span>
      </span>
    </span>
    <Icon
      name="lucide:chevron-right"
      size="20"
      class="shrink-0"
    />
  </button>
</template>

<script setup lang="ts">
import type { MemoryEntry } from '#shared/types/memory.d'

const props = defineProps<{
  entry: MemoryEntry
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
}>()

const isSensitive = computed<boolean>(() => {
  return props.entry.sensitivity === 'special'
})

const metaLabel = computed<string>(() => {
  const age = formatMemoryUpdatedAge(new Date(props.entry.updatedAt))
  const origin = getMemoryEntryOriginLabel(props.entry.origin)

  return `Updated ${age} · ${origin}`
})
</script>
