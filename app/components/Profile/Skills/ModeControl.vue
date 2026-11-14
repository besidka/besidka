<template>
  <label
    class="flex shrink-0 items-center"
    :class="{ 'gap-2 text-sm': hasLabel }"
    :data-testid="testId"
  >
    <span :class="hasLabel ? '' : 'sr-only'">
      Mode for {{ skill.name }}
    </span>
    <select
      ref="selectRef"
      class="select select-sm max-sm:min-h-11 w-auto min-w-34"
      :title="SKILL_MODE_DESCRIPTIONS[mode]"
      :value="mode"
      :disabled="isDisabled || skill.status === 'broken'"
      :data-testid="`${testId}-select`"
      @change="onChange"
    >
      <option
        v-for="option in SKILL_MODES"
        :key="option"
        :value="option"
      >
        {{ SKILL_MODE_LABELS[option] }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
import {
  SKILL_MODES,
  SKILL_MODE_DESCRIPTIONS,
  SKILL_MODE_LABELS,
  getSkillMode,
} from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import type { SkillSummary } from '#shared/types/skills.d'

const props = withDefaults(defineProps<{
  skill: Pick<
    SkillSummary,
    'name' | 'enabled' | 'modelInvocable' | 'slashCommand' | 'status'
  >
  isDisabled?: boolean
  hasLabel?: boolean
  testId?: string
}>(), {
  isDisabled: false,
  hasLabel: false,
  testId: 'skill-mode',
})

const emit = defineEmits<{
  select: [mode: SkillMode]
}>()

const selectRef = useTemplateRef<HTMLSelectElement>('selectRef')

const mode = computed<SkillMode>(() => {
  return getSkillMode(props.skill)
})

function onChange(event: Event) {
  const select = event.target as HTMLSelectElement
  const selected = select.value as SkillMode

  select.value = mode.value

  if (selected !== mode.value) {
    emit('select', selected)
  }
}
</script>
