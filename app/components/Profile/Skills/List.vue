<template>
  <div
    v-if="hasError"
    class="alert alert-error alert-soft items-start"
    role="alert"
    data-testid="skills-error"
  >
    <Icon
      name="lucide:circle-alert"
      size="18"
      class="shrink-0"
      aria-hidden="true"
    />
    <div class="grow">
      <p class="font-medium">
        Couldn't load your skills
      </p>
      <p class="text-sm">
        {{ errorMessage }}
      </p>
    </div>
    <button
      type="button"
      class="btn btn-sm"
      data-testid="skills-retry"
      @click="emit('retry')"
    >
      Retry
    </button>
  </div>

  <div
    v-else-if="isSkeletonVisible"
    class="flex flex-col gap-2"
    aria-hidden="true"
    data-testid="skills-skeleton"
  >
    <div
      v-for="index in SKILLS_LIBRARY_SKELETON_ROWS"
      :key="index"
      class="flex items-center gap-3 rounded-box border border-base-200/70 px-3 py-3"
    >
      <div class="flex-1 space-y-2">
        <div class="skeleton skeleton--default h-4 w-1/3 rounded-full" />
        <div class="skeleton skeleton--default h-3 w-2/3 rounded-full" />
      </div>
      <div class="skeleton skeleton--default h-6 w-10 shrink-0 rounded-full" />
      <div class="skeleton skeleton--default h-8 w-8 shrink-0 rounded-full" />
    </div>
  </div>

  <ul
    v-else-if="skills.length"
    class="list"
    data-testid="skills-list"
  >
    <ProfileSkillsRow
      v-for="skill in skills"
      :key="skill.id"
      :skill="skill"
      :is-busy="busyIds.includes(skill.id)"
      :is-selected="skill.id === selectedId"
      :can-import-from-url="canImportFromUrl"
      @open="(target, tab) => emit('open', target, tab)"
      @toggle="(target, enabled) => emit('toggle', target, enabled)"
      @review-update="target => emit('reviewUpdate', target)"
      @check-updates="target => emit('checkUpdates', target)"
      @delete="target => emit('delete', target)"
    />
  </ul>

  <div
    v-else-if="hasLoaded && isFiltered"
    class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
    data-testid="skills-no-results"
  >
    <Icon
      name="lucide:search-x"
      size="40"
      class="mx-auto mb-3 opacity-60"
      aria-hidden="true"
    />
    <p class="font-medium">
      No skills match these filters
    </p>
    <button
      type="button"
      class="btn btn-sm mt-4"
      data-testid="skills-clear"
      @click="emit('clear')"
    >
      Clear
    </button>
  </div>

  <div
    v-else-if="hasLoaded"
    class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
    data-testid="skills-empty"
  >
    <Icon
      name="lucide:sparkles"
      size="40"
      class="mx-auto mb-3 opacity-60"
      aria-hidden="true"
    />
    <p class="font-medium">
      No skills yet
    </p>
    <p class="mx-auto mt-2 mb-4 max-w-md text-sm text-base-content/70">
      No skills yet. Create one, start from a template, or import a .zip or
      a GitHub link.
    </p>
    <ProfileSkillsNewMenu
      :can-import-from-url="canImportFromUrl"
      @select="action => emit('new', action)"
    />
  </div>
</template>

<script setup lang="ts">
import type { SkillSummary } from '#shared/types/skills.d'
import type { SkillDetailTab, SkillNewAction } from '~/types/skills-ui.d'

withDefaults(defineProps<{
  skills: SkillSummary[]
  hasLoaded: boolean
  hasError?: boolean
  errorMessage?: string
  isSkeletonVisible?: boolean
  isFiltered?: boolean
  busyIds?: string[]
  selectedId?: string | null
  canImportFromUrl?: boolean
}>(), {
  hasError: false,
  errorMessage: '',
  isSkeletonVisible: false,
  isFiltered: false,
  busyIds: () => [],
  selectedId: null,
  canImportFromUrl: false,
})

const emit = defineEmits<{
  open: [skill: SkillSummary, tab: SkillDetailTab]
  toggle: [skill: SkillSummary, enabled: boolean]
  reviewUpdate: [skill: SkillSummary]
  checkUpdates: [skill: SkillSummary]
  delete: [skill: SkillSummary]
  retry: []
  clear: []
  new: [action: SkillNewAction]
}>()
</script>
