<template>
  <ProfileSkillsWorkspaceDialog
    :title="title"
    :is-busy="isSubmitting"
    hook-class="js-skill-create-modal"
    @close="emit('close')"
  >
    <form
      id="skill-create-form"
      class="grid gap-4"
      novalidate
      data-testid="skill-create-form"
      @submit.prevent="onSubmit"
    >
      <fieldset
        v-if="kind === 'template'"
        class="grid gap-2"
      >
        <legend class="mb-1 text-sm font-medium">
          Template
        </legend>
        <label
          v-for="template in SKILL_TEMPLATES"
          :key="template.id"
          class="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3 has-checked:border-accent has-checked:bg-base-200"
        >
          <input
            v-model="templateId"
            type="radio"
            name="skill-template"
            class="radio radio-sm mt-1"
            :value="template.id"
            :data-testid="`skill-template-${template.id}`"
          >
          <span class="grid gap-0.5">
            <span class="text-sm font-medium">{{ template.title }}</span>
            <span class="text-xs text-base-content/70">
              {{ template.summary }}
            </span>
          </span>
        </label>
      </fieldset>

      <div class="grid gap-1">
        <label
          for="skill-create-name"
          class="text-sm font-medium"
        >
          Name<template v-if="kind === 'template'"> (optional)</template>
        </label>
        <input
          id="skill-create-name"
          v-model="name"
          type="text"
          class="input w-full"
          :class="{ 'input-error': nameError }"
          :maxlength="SKILL_NAME_MAX"
          :placeholder="kind === 'template' ? selectedTemplateName : 'my-skill'"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          aria-describedby="skill-create-name-help"
          :aria-invalid="nameError ? 'true' : undefined"
          data-testid="skill-create-name"
        >
        <p
          id="skill-create-name-help"
          class="text-xs"
          :class="nameError ? 'text-error' : 'text-base-content/70'"
          :role="nameError ? 'alert' : undefined"
          data-testid="skill-create-name-help"
        >
          {{ nameError || NAME_HELP }}
        </p>
      </div>

      <div
        v-if="kind !== 'template'"
        class="grid gap-1"
      >
        <label
          for="skill-create-description"
          class="text-sm font-medium"
        >
          Description (optional)
        </label>
        <textarea
          id="skill-create-description"
          v-model="description"
          class="textarea w-full"
          rows="3"
          :maxlength="SKILL_DESCRIPTION_MAX"
          placeholder="What it does and when the model should use it"
          data-testid="skill-create-description"
        />
      </div>

      <div class="grid gap-1">
        <label
          for="skill-create-mode"
          class="text-sm font-medium"
        >
          Mode
        </label>
        <select
          id="skill-create-mode"
          v-model="mode"
          class="select w-full"
          data-testid="skill-create-mode"
        >
          <option
            v-for="option in SKILL_MODES"
            :key="option"
            :value="option"
          >
            {{ SKILL_MODE_LABELS[option] }}
          </option>
        </select>
        <p
          class="text-xs text-base-content/70"
          data-testid="skill-create-mode-help"
        >
          {{ SKILL_MODE_DESCRIPTIONS[mode] }}
        </p>
      </div>

      <ProfileSkillsCommandField
        v-if="commandsFeature.active"
        v-model="command"
        :server-error="commandError"
        test-id="skill-create-command"
      />

      <div
        v-if="commandsFeature.active && kind !== 'template' && hasCommand"
        class="grid gap-1"
      >
        <label
          for="skill-create-hint"
          class="text-sm font-medium"
        >
          Argument hint (optional)
        </label>
        <input
          id="skill-create-hint"
          v-model="argumentHint"
          type="text"
          class="input w-full"
          :maxlength="SKILL_ARGUMENT_HINT_MAX"
          placeholder="What to apply this to"
          data-testid="skill-create-hint"
        >
      </div>
    </form>

    <template #footer>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="isSubmitting"
        data-testid="skill-create-cancel"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="skill-create-form"
        class="btn btn-sm btn-accent"
        :disabled="!canSubmit || isSubmitting"
        data-testid="skill-create-submit"
      >
        <span
          v-if="isSubmitting"
          class="loading loading-spinner loading-xs"
        />
        Create
      </button>
    </template>
  </ProfileSkillsWorkspaceDialog>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_NAME_MAX,
  getSkillCommandProblem,
  isSkillNameValid,
  normalizeSkillCommand,
} from '#shared/utils/skills-policy'
import { SKILL_DESCRIPTION_MAX } from '#shared/utils/skills/frontmatter'
import {
  SKILL_MODES,
  SKILL_MODE_DESCRIPTIONS,
  SKILL_MODE_LABELS,
} from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import { SKILL_TEMPLATES } from '#shared/utils/skills/templates'
import type { SkillCreateKind } from '~/types/skills-ui.d'

const NAME_HELP
  = 'Lowercase letters, numbers and single hyphens, up to 64 characters.'

const props = defineProps<{
  kind: SkillCreateKind
}>()

const emit = defineEmits<{
  created: [skill: { id: string, name: string }]
  close: []
}>()

const commandsFeature = useFeature('skills.commands')

const name = shallowRef<string>('')
const description = shallowRef<string>('')
const mode = shallowRef<SkillMode>('auto')
const command = shallowRef<string>('')
const argumentHint = shallowRef<string>('')
const templateId = shallowRef<string>(SKILL_TEMPLATES[0]?.id ?? '')
const isSubmitting = shallowRef<boolean>(false)
const serverError = shallowRef<string>('')
const commandError = shallowRef<string>('')

const title = computed<string>(() => {
  return props.kind === 'template' ? 'New skill from a template' : 'New skill'
})

const selectedTemplate = computed(() => {
  return SKILL_TEMPLATES.find((template) => {
    return template.id === templateId.value
  }) ?? null
})

const selectedTemplateName = computed<string>(() => {
  return selectedTemplate.value?.name ?? ''
})

const trimmedName = computed<string>(() => name.value.trim())

const normalizedCommand = computed<string | null>(() => {
  return commandsFeature.value.active
    ? normalizeSkillCommand(command.value)
    : null
})

const hasCommand = computed<boolean>(() => {
  return normalizedCommand.value !== null
})

const nameError = computed<string>(() => {
  if (serverError.value) {
    return serverError.value
  }

  if (!trimmedName.value) {
    return ''
  }

  return isSkillNameValid(trimmedName.value)
    ? ''
    : 'Use lowercase letters, numbers and single hyphens (max 64)'
})

const hasCommandProblem = computed<boolean>(() => {
  return !!commandError.value || (
    commandsFeature.value.active
    && !!getSkillCommandProblem(command.value)
  )
})

const canSubmit = computed<boolean>(() => {
  if (hasCommandProblem.value) {
    return false
  }

  if (nameError.value && !serverError.value) {
    return false
  }

  return props.kind === 'template' ? !!templateId.value : !!trimmedName.value
})

watch(name, () => {
  serverError.value = ''
})

watch(command, () => {
  commandError.value = ''
})

watch([templateId, commandsFeature], () => {
  if (props.kind !== 'template' || !selectedTemplate.value) {
    return
  }

  mode.value = selectedTemplate.value.modelInvocable ? 'auto' : 'ask'
  command.value = commandsFeature.value.active
    ? selectedTemplate.value.command ?? ''
    : ''
}, { immediate: true })

function buildBody() {
  const settings = {
    mode: mode.value,
    ...(normalizedCommand.value ? { command: normalizedCommand.value } : {}),
  }

  if (props.kind === 'template') {
    return {
      kind: 'template' as const,
      template: templateId.value,
      ...(trimmedName.value ? { name: trimmedName.value } : {}),
      ...settings,
    }
  }

  return {
    kind: 'blank' as const,
    name: trimmedName.value,
    ...(description.value.trim()
      ? { description: description.value.trim() }
      : {}),
    ...settings,
    ...(hasCommand.value && argumentHint.value.trim()
      ? { argumentHint: argumentHint.value.trim() }
      : {}),
  }
}

async function onSubmit() {
  if (!canSubmit.value || isSubmitting.value) {
    return
  }

  isSubmitting.value = true

  try {
    const created = await $fetch('/api/v1/skills', {
      method: 'POST',
      body: buildBody(),
    })

    emit('created', { id: created.id, name: created.name })
    emit('close')
  } catch (exception) {
    const parsedException = parseError(exception)
    const reason = parsedException.why
      ? `${parsedException.message}. ${parsedException.why}`
      : parsedException.message || 'The skill could not be created.'

    if (
      parsedException.code === 'command-taken'
      || parsedException.code === 'reserved-name'
    ) {
      commandError.value = reason
    } else {
      serverError.value = reason
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>
