<template>
  <div
    class="flex flex-col items-center gap-2 rounded-box bg-base-content/5 px-4 py-8 text-center text-base-content/70"
    data-testid="memory-entries-empty"
  >
    <Icon name="lucide:brain" size="24" />
    <p class="font-bold text-base-content">Nothing remembered yet</p>
    <p
      v-if="projectId"
      class="text-sm"
      data-testid="memory-entries-empty-project"
    >
      Memory saved in this project's chats shows up here.
    </p>
    <template v-else>
      <p class="text-sm">
        Ask Besidka in any chat to remember something — for example,
        “Remember that I prefer short answers.”
      </p>
      <p
        v-if="!settings.memoryExtractionEnabled"
        class="text-sm"
        data-testid="memory-entries-empty-generation-hint"
      >
        Or turn on Generate memory from chats above and let Besidka pick up
        lasting facts for you.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { MemorySettingsFields } from '#shared/types/memory.d'

defineProps<{
  settings: MemorySettingsFields
  projectId: string | null
}>()
</script>
