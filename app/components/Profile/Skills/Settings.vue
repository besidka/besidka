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
      <label class="flex cursor-pointer items-start justify-between gap-4">
        <span class="grid gap-0.5">
          <span class="text-sm font-medium">
            The model can use it on its own
          </span>
          <span class="text-xs text-base-content/70">
            Its name and description go in every message, about
            {{ tokens }} tokens, so the model can load it when a task fits.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle toggle-sm mt-1 shrink-0"
          :checked="skill.modelInvocable"
          :disabled="isBusy"
          data-testid="skill-setting-model-invocable"
          @click.prevent="onSetting({ modelInvocable: !skill.modelInvocable })"
        >
      </label>
      <label class="flex cursor-pointer items-start justify-between gap-4">
        <span class="grid gap-0.5">
          <span class="text-sm font-medium">
            Use as a /{{ skill.name }} command
          </span>
          <span class="text-xs text-base-content/70">
            Run it by typing /{{ skill.name }} at the start of a message.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle toggle-sm mt-1 shrink-0"
          :checked="skill.slashCommand"
          :disabled="isBusy"
          data-testid="skill-setting-slash-command"
          @click.prevent="onSetting({ slashCommand: !skill.slashCommand })"
        >
      </label>
      <form
        v-if="skill.slashCommand"
        class="grid gap-1"
        @submit.prevent="onSaveHint"
      >
        <label
          for="skill-argument-hint"
          class="text-sm font-medium"
        >
          Argument hint
        </label>
        <div class="join w-full">
          <input
            id="skill-argument-hint"
            v-model="hint"
            type="text"
            class="input input-sm join-item w-full"
            :maxlength="SKILL_ARGUMENT_HINT_MAX"
            placeholder="What to apply this to"
            data-testid="skill-setting-argument-hint"
          >
          <button
            type="submit"
            class="btn btn-sm join-item"
            :disabled="isBusy || !isHintChanged"
            data-testid="skill-setting-argument-hint-save"
          >
            Save
          </button>
        </div>
        <p class="text-xs text-base-content/70">
          Shown in the message box while the command is chosen.
        </p>
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
import { SKILL_ARGUMENT_HINT_MAX } from '#shared/utils/skills-policy'
import type { SkillDetail } from '#shared/types/skills.d'

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

const hint = shallowRef<string>(props.skill.argumentHint ?? '')

const isBusy = computed<boolean>(() => {
  return actions.isBusy(props.skill.id)
})

const tokens = computed<number>(() => {
  return estimateSkillCatalogTokens(props.skill)
})

const isHintChanged = computed<boolean>(() => {
  return hint.value.trim() !== (props.skill.argumentHint ?? '')
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

async function onSetting(changes: {
  modelInvocable?: boolean
  slashCommand?: boolean
}) {
  await actions.saveSettings(props.skill.id, changes)
}

async function onSaveHint() {
  await actions.saveSettings(props.skill.id, {
    argumentHint: hint.value.trim() || null,
  })
}

async function onDownload(event: MouseEvent) {
  await onDownloadClick(event, {
    url: `/api/v1/skills/${props.skill.id}/download`,
    fileName: `${props.skill.name}.zip`,
  })
}
</script>
