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
      v-if="skill.hasScripts && scriptsFeature.enabled"
      class="grid gap-2"
      aria-labelledby="skill-settings-scripts"
      data-testid="skill-setting-scripts"
    >
      <h3
        id="skill-settings-scripts"
        class="font-semibold"
      >
        Scripts
      </h3>
      <label class="flex cursor-pointer items-center justify-between gap-3">
        <span class="min-w-0 flex-1 text-sm">
          Allow scripts in Anthropic's container
        </span>
        <input
          type="checkbox"
          class="toggle toggle-sm shrink-0"
          :checked="skill.allowScripts"
          :disabled="isBusy || !canToggleScripts"
          data-testid="skill-setting-scripts-toggle"
          @change="onToggleScripts"
        >
      </label>
      <p
        v-if="!scriptsFeature.active"
        class="text-xs text-base-content/70"
        data-testid="skill-setting-scripts-optin"
      >
        Turn on Skill scripts in Labs to run the scripts of this skill. They
        use your own Anthropic key.
      </p>
      <p
        v-else
        class="text-xs text-base-content/70"
      >
        The model can run the scripts of this skill in Anthropic's code
        sandbox on your key. Besidka asks once per chat before the skill is
        uploaded, and only when Run code is on for the message.
      </p>
      <p
        v-if="skill.allowScripts && skill.scriptsUploaded"
        class="text-xs text-base-content/70"
        data-testid="skill-setting-scripts-uploaded"
      >
        Uploaded to your Anthropic workspace<template
          v-if="skill.scriptsProviderName"
        > as {{ skill.scriptsProviderName }}</template>. Turning this off
        deletes that copy.
      </p>
      <p
        v-else-if="skill.allowScripts"
        class="text-xs text-base-content/70"
      >
        Not uploaded yet. Besidka uploads it the first time you allow scripts
        in a chat.
      </p>
    </section>

    <section
      class="grid gap-2"
      aria-labelledby="skill-settings-about"
    >
      <h3
        id="skill-settings-about"
        class="font-semibold"
      >
        License and source
      </h3>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-base-content/70">
          License
        </dt>
        <dd data-testid="skill-setting-license">
          {{ getSkillLicenseLabel(skill.license.class) }}
          <span v-if="skill.license.field">
            ({{ skill.license.field }})
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
        <template v-if="skill.updateAvailable && skill.pendingVersion === null">
          <dt class="text-base-content/70">
            Update
          </dt>
          <dd class="flex min-w-0 flex-wrap items-center gap-2">
            <span
              class="badge badge-soft badge-info badge-sm"
              data-testid="skill-setting-update"
            >
              Update {{ skill.updateAvailable.label }}
            </span>
            <span class="text-xs text-base-content/70">
              Found by the daily check. Check for updates shows what changed.
            </span>
          </dd>
        </template>
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
    <LazyProfileSkillsScriptsDialog
      ref="scriptsDialog"
      :skill="skill"
      @confirm="onConfirmScripts"
    />
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
const scriptsFeature = useFeature('skills.scripts')
const scriptsDialog = useTemplateRef<{ open: () => void }>('scriptsDialog')

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

const canToggleScripts = computed<boolean>(() => {
  return props.skill.allowScripts || scriptsFeature.value.active
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

async function onToggleScripts(event: Event) {
  const input = event.target as HTMLInputElement

  if (!input.checked) {
    await actions.setScripts(props.skill, false)

    return
  }

  input.checked = false
  scriptsDialog.value?.open()
}

async function onConfirmScripts() {
  await actions.setScripts(props.skill, true)
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
