<template>
  <UiBubble
    class="mb-4 !block bg-base-100 dark:bg-base-100/10 shadow-none"
    role="region"
    :aria-labelledby="headingId"
    data-testid="project-skills-card"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2
          :id="headingId"
          class="text-sm font-semibold"
        >
          Project skills
        </h2>
        <p class="mt-1 text-sm opacity-70">
          Skills Besidka uses in this project's chats.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-primary shrink-0 normal-case"
        :disabled="isSaving || !canAdd"
        data-testid="project-skills-add"
        @click="openPicker"
      >
        <Icon
          name="lucide:plus"
          size="16"
        />
        Add skill
      </button>
    </div>

    <div
      v-if="isLoading"
      class="mt-4 grid gap-3"
      data-testid="project-skills-skeleton"
    >
      <div class="skeleton skeleton--default h-12 w-full" />
    </div>
    <p
      v-else-if="pins.length === 0"
      class="mt-4 rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
      data-testid="project-skills-empty"
    >
      No skills yet. Add a skill to load it in every message, or to make it
      the first choice in this project.
    </p>
    <ul
      v-else
      class="mt-4 grid gap-2"
      data-testid="project-skills-list"
    >
      <li
        v-for="pin in pins"
        :key="pin.skillId"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box bg-base-200/60 px-3 py-2"
        :data-testid="`project-skill-${pin.name}`"
      >
        <Icon
          name="lucide:sparkles"
          size="16"
          class="shrink-0 opacity-75"
          aria-hidden="true"
        />
        <div class="flex min-w-0 grow basis-40 flex-col">
          <span class="truncate text-sm font-medium">
            {{ pin.name }}
          </span>
          <span
            v-if="getPinNote(pin)"
            class="truncate text-xs text-base-content/60"
            :data-testid="`project-skill-note-${pin.name}`"
          >
            {{ getPinNote(pin) }}
          </span>
        </div>
        <span
          v-if="pin.state !== 'active'"
          class="badge badge-soft badge-sm shrink-0"
          :data-testid="`project-skill-state-${pin.name}`"
        >
          {{ STATE_LABELS[pin.state] }}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <select
            class="select select-sm w-auto shrink-0"
            :value="pin.level"
            :disabled="isSaving"
            :aria-label="`When to use ${pin.name}`"
            :data-testid="`project-skill-level-${pin.name}`"
            @change="onLevelChange(pin, $event)"
          >
            <option
              v-for="level in PROJECT_SKILL_LEVELS"
              :key="level"
              :value="level"
              :selected="level === pin.level"
            >
              {{ LEVEL_LABELS[level] }}
            </option>
          </select>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost shrink-0"
            :disabled="isSaving"
            :aria-label="`Remove ${pin.name} from this project`"
            :data-testid="`project-skill-remove-${pin.name}`"
            @click="onRemove(pin)"
          >
            <Icon
              name="lucide:x"
              size="16"
            />
          </button>
        </div>
      </li>
    </ul>

    <p
      v-if="alwaysTokens > 0"
      class="mt-3 text-xs text-base-content/70"
      data-testid="project-skills-tokens"
    >
      ≈ {{ alwaysTokens.toLocaleString('en-US') }} tokens in every message
      from skills set to Always load.
    </p>

    <LazyChatInputSkillPicker
      v-if="isPickerMounted"
      v-model:open="isPickerOpen"
      :items="pickerItems"
      :selected-id="null"
      subtitle="Add one skill to this project"
      @pick="onPick"
    />
  </UiBubble>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  PROJECT_SKILL_LEVELS,
  PROJECT_SKILLS_ALWAYS_MAX,
  PROJECT_SKILLS_MAX,
} from '#shared/utils/skills-policy'
import type { ProjectSkillLevel } from '#shared/utils/skills-policy'
import type { ComposerSkillItem } from '~/composables/composer-skills'

const props = defineProps<{
  projectId: string
}>()

const LEVEL_LABELS: Record<ProjectSkillLevel, string> = {
  always: 'Always load',
  prefer: 'Prefer',
}

const STATE_LABELS = {
  'active': 'On',
  'off': 'Off',
  'needs-review': 'Needs review',
  'broken': 'Broken',
} as const

const headingId = useId()
const nuxtApp = useNuxtApp()
const composerSkills = useComposerSkills()
const isPickerMounted = shallowRef<boolean>(false)
const isPickerOpen = shallowRef<boolean>(false)
const isSaving = shallowRef<boolean>(false)

const { data, status, refresh } = useLazyFetch(
  () => `/api/v1/projects/${props.projectId}/skills`,
  { key: () => `project-skills:${props.projectId}` },
)

type ProjectSkillsView = NonNullable<typeof data.value>
type ProjectSkillPin = ProjectSkillsView['pins'][number]

const pins = computed<ProjectSkillPin[]>(() => data.value?.pins ?? [])
const alwaysTokens = computed<number>(() => data.value?.alwaysTokens ?? 0)
const isLoading = computed<boolean>(() => {
  return !data.value && status.value === 'pending'
})

const alwaysCount = computed<number>(() => {
  return pins.value.filter(pin => pin.level === 'always').length
})

const pickerItems = computed<ComposerSkillItem[]>(() => {
  const pinnedIds = new Set(pins.value.map(pin => pin.skillId))

  return composerSkills.items.value.filter((item) => {
    return !pinnedIds.has(item.id)
  })
})

const canAdd = computed<boolean>(() => {
  return pins.value.length < PROJECT_SKILLS_MAX
})

function getPinNote(pin: ProjectSkillPin): string {
  if (pin.state === 'off') {
    return 'Turn the skill on in Skills for it to load.'
  }

  if (pin.state === 'needs-review') {
    return 'Review the skill in Skills for it to load.'
  }

  if (pin.state === 'broken') {
    return 'This skill cannot load until it is repaired.'
  }

  if (pin.level === 'always' && pin.tokens !== null) {
    return `≈ ${pin.tokens.toLocaleString('en-US')} tokens in every message`
  }

  return pin.level === 'prefer'
    ? 'Listed first for the model in this project'
    : ''
}

function openPicker() {
  isPickerMounted.value = true
  isPickerOpen.value = true
}

async function save(
  entries: Array<{ skillId: string, level: ProjectSkillLevel }>,
  failureTitle: string,
): Promise<boolean> {
  isSaving.value = true

  try {
    data.value = await $fetch(`/api/v1/projects/${props.projectId}/skills`, {
      method: 'PUT',
      body: { skills: entries },
    })

    return true
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || failureTitle,
        parsedException.why,
      )
    })

    await refresh()

    return false
  } finally {
    isSaving.value = false
  }
}

function toEntries() {
  return pins.value.map((pin) => {
    return { skillId: pin.skillId, level: pin.level }
  })
}

async function onPick(item: ComposerSkillItem) {
  const level: ProjectSkillLevel = alwaysCount.value < PROJECT_SKILLS_ALWAYS_MAX
    ? 'always'
    : 'prefer'

  await save(
    [...toEntries(), { skillId: item.id, level }],
    'Failed to add the skill',
  )
}

async function onLevelChange(pin: ProjectSkillPin, event: Event) {
  const select = event.target as HTMLSelectElement
  const level = select.value as ProjectSkillLevel
  const isSaved = await save(
    toEntries().map((entry) => {
      return entry.skillId === pin.skillId ? { ...entry, level } : entry
    }),
    'Failed to update the skill',
  )

  if (!isSaved) {
    select.value = pin.level
  }
}

async function onRemove(pin: ProjectSkillPin) {
  await save(
    toEntries().filter(entry => entry.skillId !== pin.skillId),
    'Failed to remove the skill',
  )
}
</script>
