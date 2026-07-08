<template>
  <li class="menu-title text-xs">
    Deep research
  </li>
  <li>
    <button
      type="button"
      data-testid="deep-research-option-off"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          researchLevel === 'off',
      }"
      @click="emit('select-research-level', 'off')"
    >
      <Icon name="lucide:circle-off" size="16" class="text-current" />
      <span>Off</span>
    </button>
  </li>
  <li
    v-for="entry in levelEntries"
    :key="entry.level"
  >
    <button
      type="button"
      :data-testid="`deep-research-option-${entry.level}`"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          researchLevel === entry.level,
      }"
      @click="emit('select-research-level', entry.level)"
    >
      <Icon name="lucide:telescope" size="16" class="text-current" />
      <span class="flex flex-col items-start">
        <span>{{ entry.config.label }}</span>
        <span class="text-[.65rem] font-normal opacity-70">
          {{ entry.config.costEstimate }} · {{ entry.config.timeEstimate }}
        </span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import type {
  ProviderResearchCapability,
  ResearchLevelSetting,
} from '#shared/types/research.d'

const props = defineProps<{
  researchLevel: ResearchLevelSetting
  capability: ProviderResearchCapability | null
}>()

const emit = defineEmits<{
  'select-research-level': [level: ResearchLevelSetting]
}>()

const levelEntries = computed(() => {
  return getResearchLevelEntries(props.capability)
})
</script>
