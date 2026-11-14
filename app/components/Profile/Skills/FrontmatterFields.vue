<template>
  <div
    class="grid gap-4"
    data-testid="skill-frontmatter-fields"
  >
    <div class="grid gap-1">
      <label
        for="skill-edit-name"
        class="text-sm font-medium"
      >
        Name
      </label>
      <input
        id="skill-edit-name"
        v-model="name"
        type="text"
        class="input w-full font-mono"
        :class="{ 'input-error': !!nameError }"
        :maxlength="SKILL_NAME_MAX"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        aria-describedby="skill-edit-name-help"
        :aria-invalid="nameError ? 'true' : undefined"
        data-testid="skill-edit-name"
        @blur="emit('name-blur')"
      >
      <p
        id="skill-edit-name-help"
        class="text-xs"
        :class="nameError ? 'text-error' : 'text-base-content/70'"
        :role="nameError ? 'alert' : undefined"
        data-testid="skill-edit-name-help"
      >
        {{ nameError || NAME_HELP }}
      </p>
      <ProfileSkillsProblemList
        :problems="problemsFor('name')"
        @fix="problem => emit('fix', problem)"
      />
    </div>

    <div class="grid gap-1">
      <label
        for="skill-edit-description"
        class="text-sm font-medium"
      >
        Description
      </label>
      <textarea
        id="skill-edit-description"
        v-model="description"
        class="textarea w-full"
        :class="{ 'textarea-error': !!descriptionError }"
        rows="3"
        aria-describedby="skill-edit-description-help"
        :aria-invalid="descriptionError ? 'true' : undefined"
        data-testid="skill-edit-description"
      />
      <div
        id="skill-edit-description-help"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
      >
        <p
          v-if="descriptionError"
          class="text-error"
          role="alert"
          data-testid="skill-edit-description-error"
        >
          {{ descriptionError }}
        </p>
        <p
          v-else
          class="text-base-content/70"
          data-testid="skill-edit-description-help"
        >
          What the skill does and when the model should use it.
        </p>
        <span
          class="tabular-nums text-base-content/70"
          data-testid="skill-edit-description-counter"
        >
          {{ description.length.toLocaleString() }}
          / {{ SKILL_DESCRIPTION_MAX.toLocaleString() }}
        </span>
      </div>
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        data-testid="skill-edit-catalog-cost"
      >
        <span
          v-if="isModelInvocable"
          class="text-base-content/70"
          data-testid="skill-edit-tokens"
        >
          ≈ {{ catalogTokens.toLocaleString() }} tokens in every message
        </span>
        <span
          v-else
          class="text-base-content/70"
          data-testid="skill-edit-tokens-off"
        >
          Not in the model's list of skills, so it costs no tokens until you
          run it with /{{ name || 'name' }}.
        </span>
        <span
          v-if="isShortened"
          class="badge badge-soft badge-warning badge-sm"
          data-testid="skill-edit-shortened"
        >
          <Icon name="lucide:scissors" size="12" aria-hidden="true" />
          Shortened in the catalog
        </span>
      </div>
      <p
        v-if="isShortened"
        class="text-xs text-base-content/70"
        data-testid="skill-edit-shortened-note"
      >
        Past {{ SKILL_DESCRIPTION_CATALOG_SOFT_MAX }} characters the catalog
        keeps the first sentence when it runs out of room. Put the key point
        first.
      </p>
      <ProfileSkillsProblemList
        :problems="problemsFor('description')"
        @fix="problem => emit('fix', problem)"
      />
    </div>

    <details
      class="rounded-box border border-base-300"
      :open="isAdvancedOpen"
      data-testid="skill-edit-advanced"
      @toggle="onAdvancedToggle"
    >
      <summary
        class="min-h-11 cursor-pointer select-none px-3 py-2 text-sm font-medium sm:min-h-9"
        data-testid="skill-edit-advanced-summary"
      >
        Advanced (YAML)
      </summary>
      <div class="grid gap-1 px-3 pb-3">
        <label
          for="skill-edit-advanced-text"
          class="text-xs text-base-content/70"
        >
          Other frontmatter keys: license, compatibility, metadata,
          allowed-tools and any unknown key. Name and description are above.
        </label>
        <textarea
          id="skill-edit-advanced-text"
          v-model="advanced"
          class="textarea w-full font-mono text-xs"
          :class="{ 'textarea-error': hasAdvancedError }"
          rows="5"
          spellcheck="false"
          autocapitalize="none"
          autocorrect="off"
          aria-describedby="skill-edit-advanced-problems"
          :aria-invalid="hasAdvancedError ? 'true' : undefined"
          data-testid="skill-edit-advanced-text"
        />
        <ProfileSkillsProblemList
          id="skill-edit-advanced-problems"
          :problems="advancedProblems"
          @fix="problem => emit('fix', problem)"
        />
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import {
  SKILL_DESCRIPTION_CATALOG_SOFT_MAX,
  SKILL_NAME_MAX,
} from '#shared/utils/skills-policy'
import { SKILL_DESCRIPTION_MAX } from '#shared/utils/skills/frontmatter'

const NAME_HELP
  = 'Lowercase letters, numbers and single hyphens, up to 64 characters.'

const props = withDefaults(defineProps<{
  nameError?: string
  descriptionError?: string
  problems?: SkillEditorProblem[]
  catalogTokens?: number
  isModelInvocable?: boolean
}>(), {
  nameError: '',
  descriptionError: '',
  problems: () => [],
  catalogTokens: 0,
  isModelInvocable: true,
})

const emit = defineEmits<{
  'name-blur': []
  'fix': [problem: SkillEditorProblem]
}>()

const name = defineModel<string>('name', { required: true })
const description = defineModel<string>('description', { required: true })
const advanced = defineModel<string>('advanced', { required: true })

const isAdvancedExpanded = shallowRef<boolean>(false)

const isShortened = computed<boolean>(() => {
  return description.value.length > SKILL_DESCRIPTION_CATALOG_SOFT_MAX
})

const advancedProblems = computed<SkillEditorProblem[]>(() => {
  return problemsFor('advanced')
})

const hasAdvancedError = computed<boolean>(() => {
  return advancedProblems.value.some((problem) => {
    return problem.severity === 'error'
  })
})

const isAdvancedOpen = computed<boolean>(() => {
  return isAdvancedExpanded.value || hasAdvancedError.value
})

function problemsFor(scope: SkillEditorProblemScope): SkillEditorProblem[] {
  return props.problems.filter((problem) => {
    return problem.scope === scope
  })
}

function onAdvancedToggle(event: Event) {
  isAdvancedExpanded.value = (event.target as HTMLDetailsElement).open
}
</script>
