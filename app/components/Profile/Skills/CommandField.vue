<template>
  <div class="grid gap-1">
    <label
      :for="inputId"
      class="text-sm font-medium"
    >
      Command (optional)
    </label>
    <input
      :id="inputId"
      v-model="command"
      type="text"
      class="input w-full"
      :class="{ 'input-error': problem }"
      :maxlength="SKILL_NAME_MAX + 1"
      placeholder="/my-command"
      autocapitalize="none"
      autocomplete="off"
      spellcheck="false"
      :aria-describedby="helpId"
      :aria-invalid="problem ? 'true' : undefined"
      :data-testid="testId"
    >
    <p
      :id="helpId"
      class="text-xs"
      :class="problem ? 'text-error' : 'text-base-content/70'"
      :role="problem ? 'alert' : undefined"
      :data-testid="`${testId}-help`"
    >
      {{ problem || COMMAND_HELP }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  SKILL_NAME_MAX,
  getSkillCommandProblem,
} from '#shared/utils/skills-policy'

const COMMAND_HELP
  = 'Type it in the message box to run this skill. Lowercase letters, '
    + 'numbers and single hyphens.'

const props = withDefaults(defineProps<{
  serverError?: string
  testId?: string
}>(), {
  serverError: '',
  testId: 'skill-command',
})

const command = defineModel<string>({ required: true })

const inputId = useId()
const helpId = useId()

const problem = computed<string>(() => {
  return props.serverError || getSkillCommandProblem(command.value)
})
</script>
