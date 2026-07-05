<template>
  <li class="menu-title text-xs">
    Research depth
  </li>
  <li
    v-for="depth in depthsForMenu"
    :key="depth"
  >
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          researchDepth === depth,
      }"
      @click="emit('select-research-depth', depth)"
    >
      <Icon :name="getIconName(depth)" size="16" class="text-current" />
      <span class="capitalize">{{ getDepthLabel(depth) }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import type { ResearchDepthSetting } from '#shared/types/research.d'

defineProps<{
  researchDepth: ResearchDepthSetting
}>()

const emit = defineEmits<{
  'select-research-depth': [depth: ResearchDepthSetting]
}>()

const depthsForMenu = computed<ResearchDepthSetting[]>(() => {
  return ['off', ...researchDepths]
})

function getIconName(depth: ResearchDepthSetting): string {
  return depth === 'off' ? 'lucide:circle-off' : 'lucide:telescope'
}

function getDepthLabel(depth: ResearchDepthSetting): string {
  return depth === 'off' ? 'Off' : getResearchBudget(depth).label
}
</script>
