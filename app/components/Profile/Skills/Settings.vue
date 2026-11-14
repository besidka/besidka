<template>
  <div class="grid gap-5">
    <section
      class="grid gap-3"
      aria-labelledby="skill-settings-use"
    >
      <h3
        id="skill-settings-use"
        class="font-semibold"
      >
        How it is used
      </h3>
      <ProfileSkillsModeControl
        :skill="skill"
        :is-disabled="isBusy"
        has-label
        test-id="skill-setting-mode"
        @select="onSelectMode"
      />
      <p
        class="text-xs text-base-content/70"
        data-testid="skill-setting-mode-description"
      >
        {{ SKILL_MODE_DESCRIPTIONS[mode] }}
        <template v-if="mode === 'auto'">
          Its name and description go in every message, about
          {{ tokens }} tokens.
        </template>
      </p>
      <form
        v-if="commandsFeature.active"
        class="grid gap-3"
        novalidate
        data-testid="skill-setting-command-form"
        @submit.prevent="onSaveCommand"
      >
        <ProfileSkillsCommandField
          v-model="commandInput"
          :server-error="commandError"
          test-id="skill-setting-command"
        />
        <div
          v-if="hasCommandInput"
          class="grid gap-1"
        >
          <label
            for="skill-argument-hint"
            class="text-sm font-medium"
          >
            Argument hint
          </label>
          <input
            id="skill-argument-hint"
            v-model="hint"
            type="text"
            class="input input-sm w-full"
            :maxlength="SKILL_ARGUMENT_HINT_MAX"
            placeholder="What to apply this to"
            data-testid="skill-setting-argument-hint"
          >
          <p class="text-xs text-base-content/70">
            Shown in the message box while the command is chosen.
          </p>
        </div>
        <div>
          <button
            type="submit"
            class="btn btn-sm"
            :disabled="isBusy || !isCommandChanged || !!commandProblem"
            data-testid="skill-setting-command-save"
          >
            Save command
          </button>
        </div>
      </form>
    </section>

    <section
      class="grid gap-2"
      aria-labelledby="skill-settings-about"
    >
      <h3
        id="skill-settings-about"
        class="font-semibold"
      >
        Licence and source
      </h3>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-base-content/70">
          Licence
        </dt>
        <dd data-testid="skill-setting-licence">
          {{ getSkillLicenceLabel(skill.licence.class) }}
          <span v-if="skill.licence.field">
            ({{ skill.licence.field }})
          </span>
        </dd>
        <dt class="text-base-content/70">
          Source
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="skill-setting-source"
        >
          <a
            v-if="sourceLink"
            :href="sourceLink"
            target="_blank"
            rel="noopener noreferrer"
            class="link"
          >
            {{ formatSkillSource(skill) }}
          </a>
          <template v-else>
            {{ formatSkillSource(skill) }}
          </template>
        </dd>
        <template v-if="skill.compatibility">
          <dt class="text-base-content/70">
            Compatibility
          </dt>
          <dd class="min-w-0 break-words">
            {{ skill.compatibility }}
          </dd>
        </template>
        <template v-if="skill.allowedTools?.length">
          <dt class="text-base-content/70">
            Requested tools
          </dt>
          <dd class="min-w-0 break-words">
            {{ skill.allowedTools.join(', ') }}
            <span class="text-xs text-base-content/70">
              (requested by the author, not granted)
            </span>
          </dd>
        </template>
      </dl>
    </section>

    <section
      class="grid gap-2"
      aria-labelledby="skill-settings-manage"
    >
      <h3
        id="skill-settings-manage"
        class="font-semibold"
      >
        Manage
      </h3>
      <div class="flex flex-wrap gap-2">
        <a
          :href="`/api/v1/skills/${skill.id}/download`"
          :download="`${skill.name}.zip`"
          class="btn btn-sm"
          data-testid="skill-setting-download"
          @click="onDownload"
        >
          <Icon name="lucide:download" size="14" aria-hidden="true" />
          Download .zip
        </a>
        <button
          v-if="canCheckForUpdates"
          type="button"
          class="btn btn-sm"
          :disabled="isBusy"
          data-testid="skill-setting-check-updates"
          @click="emit('checkUpdates')"
        >
          <Icon name="lucide:refresh-cw" size="14" aria-hidden="true" />
          Check for updates
        </button>
        <button
          type="button"
          class="btn btn-sm btn-error btn-soft"
          :disabled="isBusy"
          data-testid="skill-setting-delete"
          @click="emit('delete')"
        >
          <Icon name="lucide:trash-2" size="14" aria-hidden="true" />
          Delete
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  SKILL_ARGUMENT_HINT_MAX,
  getSkillCommandProblem,
  normalizeSkillCommand,
} from '#shared/utils/skills-policy'
import type { SkillDetail } from '#shared/types/skills.d'
import {
  SKILL_MODE_DESCRIPTIONS,
  getSkillMode,
} from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'

const props = defineProps<{
  skill: SkillDetail
}>()

const emit = defineEmits<{
  checkUpdates: []
  delete: []
}>()

const importFromUrl = useFeature('skills.import-url')
const actions = useSkillActions()
const { onDownloadClick } = useFileDownload()

const commandsFeature = useFeature('skills.commands')

const commandInput = shallowRef<string>(props.skill.command ?? '')
const hint = shallowRef<string>(props.skill.argumentHint ?? '')
const commandError = shallowRef<string>('')

const isBusy = computed<boolean>(() => {
  return actions.isBusy(props.skill.id)
})

const tokens = computed<number>(() => {
  return estimateSkillCatalogTokens(props.skill)
})

const mode = computed<SkillMode>(() => {
  return getSkillMode(props.skill)
})

const hasCommandInput = computed<boolean>(() => {
  return normalizeSkillCommand(commandInput.value) !== null
})

const commandProblem = computed<string>(() => {
  return getSkillCommandProblem(commandInput.value)
})

const isCommandChanged = computed<boolean>(() => {
  const command = normalizeSkillCommand(commandInput.value)

  return command !== props.skill.command
    || (command !== null
      && hint.value.trim() !== (props.skill.argumentHint ?? ''))
})

const canCheckForUpdates = computed<boolean>(() => {
  return props.skill.sourceKind === 'github' && importFromUrl.value.active
})

const sourceLink = computed<string | null>(() => {
  const url = props.skill.sourceUrl

  return props.skill.sourceKind === 'github' && url?.startsWith('https://')
    ? url
    : null
})

watch(() => props.skill.argumentHint, (value) => {
  hint.value = value ?? ''
})

watch(() => props.skill.command, (value) => {
  commandInput.value = value ?? ''
})

watch(commandInput, () => {
  commandError.value = ''
})

async function onSelectMode(selected: SkillMode) {
  await actions.setMode(props.skill, selected)
}

async function onSaveCommand() {
  const command = normalizeSkillCommand(commandInput.value)

  commandError.value = await actions.saveCommand(props.skill.id, {
    command,
    argumentHint: command === null ? null : hint.value.trim() || null,
  }) ?? ''
}

async function onDownload(event: MouseEvent) {
  await onDownloadClick(event, {
    url: `/api/v1/skills/${props.skill.id}/download`,
    fileName: `${props.skill.name}.zip`,
  })
}
</script>
