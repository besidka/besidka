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
    <div class="flex items-start justify-between gap-3">
      <HistoryFilterButtons
        :options="kindOptions"
        :model-value="kind"
        label="Filter by kind"
        test-id-prefix="skills-kind"
        @select="value => emit('selectKind', parseSkillKindFilter(value))"
      />
      <div class="ml-auto shrink-0">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  SkillFilterOption,
  SkillKindFilter,
  SkillSourceFilter,
} from '~/composables/skills-library'

defineProps<{
  sourceOptions: Array<SkillFilterOption<SkillSourceFilter>>
  kindOptions: Array<SkillFilterOption<SkillKindFilter>>
  source: SkillSourceFilter
  kind: SkillKindFilter
  isSearchVisible: boolean
}>()

const emit = defineEmits<{
  selectSource: [source: SkillSourceFilter]
  selectKind: [kind: SkillKindFilter]
}>()

const search = defineModel<string>('search', { required: true })
</script>
