<template>
  <section
    class="min-w-0"
    :aria-labelledby="headingId"
    data-testid="memory-projects"
  >
    <h3 class="mb-2 flex items-center gap-2 text-sm font-bold">
      <span :id="headingId">Projects</span>
      <span
        class="badge badge-ghost badge-sm"
        data-testid="memory-projects-count"
      >
        {{ projects.length }}
      </span>
    </h3>
    <ul class="grid gap-1">
      <ProfileMemoryEntriesProject
        v-for="project in projects"
        :id="project.id"
        :key="project.id"
        :name="project.name"
        :entries="project.entries"
        :limit="limit"
        :is-memory-off="project.isMemoryOff"
        :focus-requested="project.id === focusProjectId"
        @select="emit('select', $event)"
        @add="emit('add', $event)"
        @changed="emit('changed')"
        @focused="emit('focused')"
      />
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { MemoryEntry } from '#shared/types/memory.d'
import type { MemoryProjectSection } from '~/types/memory-entries.d'

defineProps<{
  projects: MemoryProjectSection[]
  limit: number
  focusProjectId: string | null
}>()

const emit = defineEmits<{
  select: [entry: MemoryEntry]
  add: [projectId: string]
  changed: []
  focused: []
}>()

const headingId = useId()
</script>
