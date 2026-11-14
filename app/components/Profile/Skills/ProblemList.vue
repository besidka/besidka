<template>
  <ul
    v-if="problems.length"
    class="grid gap-1 text-xs"
    aria-live="polite"
    data-testid="skill-editor-problems"
  >
    <li
      v-for="problem in problems"
      :key="problem.id"
      class="flex flex-wrap items-center gap-x-2 gap-y-1"
      :class="problem.severity === 'error' ? 'text-error' : ''"
      :data-severity="problem.severity"
      data-testid="skill-editor-problem"
    >
      <Icon
        :name="problem.severity === 'error'
          ? 'lucide:circle-alert'
          : 'lucide:triangle-alert'"
        size="14"
        class="shrink-0"
        aria-hidden="true"
      />
      <span class="min-w-0">
        <span class="font-medium">
          {{ problem.severity === 'error' ? 'Error' : 'Warning' }}<template
            v-if="problem.line"
          >, line {{ problem.line }}</template>:
        </span>
        {{ problem.message }}
      </span>
      <button
        v-if="problem.fix"
        type="button"
        class="btn btn-xs btn-ghost max-sm:min-h-11"
        data-testid="skill-editor-problem-fix"
        @click="emit('fix', problem)"
      >
        Remove hidden characters
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
defineProps<{
  problems: SkillEditorProblem[]
}>()

const emit = defineEmits<{
  fix: [problem: SkillEditorProblem]
}>()
</script>
