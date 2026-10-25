<template>
  <section
    v-if="entries.length > 0 || canAdd"
    :aria-labelledby="headingId"
    data-testid="memory-entry-essentials"
  >
    <h3 class="mb-2 flex items-center gap-2 text-sm font-bold">
      <span
        :id="headingId"
        data-testid="memory-entry-essentials-heading"
      >
        {{ heading }}
      </span>
      <span
        v-if="entries.length > 0"
        class="badge badge-ghost badge-sm"
        data-testid="memory-entry-group-count"
      >
        {{ entries.length }}
      </span>
    </h3>
    <ul
      v-if="entries.length > 0"
      class="grid gap-2"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <ProfileMemoryEntriesRow
          :entry="entry"
          :label="memoryCategoryLabels[entry.category]"
          @select="emit('select', $event)"
        />
      </li>
    </ul>
    <div
      v-else-if="canAdd"
      class="flex flex-col items-start gap-3 rounded-box border border-base-content/10 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="memory-entry-essentials-empty"
    >
      <p class="text-sm text-base-content/70">
        Tell Besidka about yourself
      </p>
      <UiButton
        size="sm"
        normal-case
        icon-name="lucide:plus"
        text="Add memory"
        data-testid="memory-essentials-add"
        @click="emit('add')"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { MemoryEntry } from '#shared/types/memory.d'

defineProps<{
  heading: string
  entries: MemoryEntry[]
  canAdd?: boolean
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
  add: []
}>()

const headingId = useId()
</script>
