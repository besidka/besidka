<template>
  <div class="flex flex-col gap-3">
    <UiSearchInput
      v-if="isSearchVisible"
      v-model="search"
      :is-searching="false"
      placeholder="Search skills..."
      class="input-sm sm:input-md"
      data-testid="skills-search"
    />
    <HistoryBoxTabs
      :options="sourceOptions"
      :model-value="source"
      label="Filter by source"
      test-id-prefix="skills-source"
      @select="value => emit('selectSource', parseSkillSourceFilter(value))"
    />
    <div class="flex items-start justify-end gap-3">
      <div class="shrink-0">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  SkillFilterOption,
  SkillSourceFilter,
} from '~/composables/skills-library'

defineProps<{
  sourceOptions: Array<SkillFilterOption<SkillSourceFilter>>
  source: SkillSourceFilter
  isSearchVisible: boolean
}>()

const emit = defineEmits<{
  selectSource: [source: SkillSourceFilter]
}>()

const search = defineModel<string>('search', { required: true })
</script>
