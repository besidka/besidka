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

      <div
        v-if="kind === 'command'"
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
  isSkillNameValid,
  validateSkillSlashName,
} from '#shared/utils/skills-policy'
import { SKILL_DESCRIPTION_MAX } from '#shared/utils/skills/frontmatter'
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

const name = shallowRef<string>('')
const description = shallowRef<string>('')
const argumentHint = shallowRef<string>('')
const templateId = shallowRef<string>(SKILL_TEMPLATES[0]?.id ?? '')
const isSubmitting = shallowRef<boolean>(false)
const serverError = shallowRef<string>('')

const title = computed<string>(() => {
  if (props.kind === 'command') {
    return 'New command'
  }

  return props.kind === 'template' ? 'New skill from a template' : 'New skill'
})

const selectedTemplateName = computed<string>(() => {
  return SKILL_TEMPLATES.find((template) => {
    return template.id === templateId.value
  })?.name ?? ''
})

const trimmedName = computed<string>(() => name.value.trim())

const nameError = computed<string>(() => {
  if (serverError.value) {
    return serverError.value
  }

  if (!trimmedName.value) {
    return ''
  }

  if (!isSkillNameValid(trimmedName.value)) {
    return 'Use lowercase letters, numbers and single hyphens (max 64)'
  }

  if (props.kind === 'command') {
    const validation = validateSkillSlashName(trimmedName.value)

    return validation.valid ? '' : validation.message
  }

  return ''
})

const canSubmit = computed<boolean>(() => {
  if (nameError.value && !serverError.value) {
    return false
  }

  return props.kind === 'template' ? !!templateId.value : !!trimmedName.value
})

watch(name, () => {
  serverError.value = ''
})

function buildBody() {
  if (props.kind === 'template') {
    return {
      kind: 'template' as const,
      template: templateId.value,
      ...(trimmedName.value ? { name: trimmedName.value } : {}),
    }
  }

  const base = {
    name: trimmedName.value,
    ...(description.value.trim()
      ? { description: description.value.trim() }
      : {}),
  }

  if (props.kind === 'command') {
    return {
      kind: 'command' as const,
      ...base,
      ...(argumentHint.value.trim()
        ? { argumentHint: argumentHint.value.trim() }
        : {}),
    }
  }

  return { kind: 'blank' as const, ...base }
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

    serverError.value = parsedException.why
      ? `${parsedException.message}. ${parsedException.why}`
      : parsedException.message || 'The skill could not be created.'
  } finally {
    isSubmitting.value = false
  }
}
</script>
