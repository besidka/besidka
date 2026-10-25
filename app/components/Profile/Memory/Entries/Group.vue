<template>
  <section
    :aria-labelledby="headingId"
    :data-category="category"
    data-testid="memory-entry-group"
  >
    <h3
      :id="headingId"
      class="mb-2 flex items-center gap-2 text-sm font-bold"
    >
      {{ memoryCategoryLabels[category] }}
      <span
        class="badge badge-ghost badge-sm"
        data-testid="memory-entry-group-count"
      >
        {{ entries.length }}
      </span>
    </h3>
    <ul class="grid gap-2">
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <ProfileMemoryEntriesRow
          :entry="entry"
          @select="emit('select', $event)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { MemoryCategory, MemoryEntry } from '#shared/types/memory.d'

const props = defineProps<{
  category: MemoryCategory
  entries: MemoryEntry[]
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
}>()

const headingId = computed<string>(() => {
  return `memory-group-${props.category}`
})
</script>
