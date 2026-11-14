<template>
  <ProfileSkillsWorkspaceDialog
    ref="dialogRef"
    :title="title"
    size="workspace"
    mode="edit"
    :is-dirty="isDirty"
    :is-busy="isSaving"
    hook-class="js-skill-edit-modal"
    @close="emit('close')"
  >
    <div
      v-if="loadState === 'loading'"
      class="grid gap-3 p-4"
      role="status"
      aria-label="Loading the skill"
      data-testid="skill-edit-loading"
    >
      <div class="skeleton skeleton--default h-10 w-full" />
      <div class="skeleton skeleton--default h-24 w-full" />
      <div class="skeleton skeleton--default h-64 w-full" />
    </div>
    <div
      v-else-if="loadState === 'error'"
      class="p-4"
    >
      <div
        class="alert alert-error alert-soft"
        role="alert"
        data-testid="skill-edit-load-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <span>{{ loadError }}</span>
        <button
          type="button"
          class="btn btn-sm"
          @click="load()"
        >
          Retry
        </button>
      </div>
    </div>
    <template v-else>
      <div
        v-if="isConflict"
        class="grid shrink-0 gap-2 border-b border-base-300 px-4 py-3 max-sm:max-h-[45dvh] max-sm:overflow-y-auto"
        data-testid="skill-edit-conflict"
      >
        <div
          class="alert alert-warning alert-soft alert-vertical sm:alert-horizontal"
          role="alert"
        >
          <Icon
            name="lucide:triangle-alert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          <div class="grid gap-1">
            <p class="font-medium">
              This skill changed since you opened it
            </p>
            <p class="text-sm">
              A newer version was saved elsewhere. Your edits are still here.
              Compare to see what changed, or reload the latest version (your
              edits are discarded).
            </p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="isComparing"
              data-testid="skill-edit-conflict-compare"
              @click="compareWithLatest()"
            >
              <span
                v-if="isComparing"
                class="loading loading-spinner loading-xs"
              />
              Compare
            </button>
            <button
              type="button"
              class="btn btn-sm"
              data-testid="skill-edit-conflict-reload"
              @click="onReload"
            >
              Reload
            </button>
          </div>
        </div>
        <div
          v-if="conflictDiff"
          class="max-h-[28dvh] overflow-auto"
          data-testid="skill-edit-conflict-diff"
        >
          <p class="mb-1 text-sm font-medium">
            Saved since v{{ baseVersion }}:
          </p>
          <ProfileSkillsDiffView
            :files="conflictDiff.diff.files"
            :added="conflictDiff.diff.added"
            :removed="conflictDiff.diff.removed"
            :truncated="conflictDiff.diff.truncated"
            :skipped="conflictDiff.skipped"
          />
        </div>
        <p
          v-if="conflictDiffError"
          class="text-sm text-error"
          role="alert"
          data-testid="skill-edit-conflict-error"
        >
          {{ conflictDiffError }}
        </p>
      </div>

      <div class="flex min-h-0 flex-1 flex-col max-sm:overflow-y-auto sm:flex-row">
        <aside
          class="shrink-0 border-b border-base-300 p-3 sm:w-64 sm:overflow-y-auto sm:border-r sm:border-b-0"
          data-testid="skill-edit-sidebar"
        >
          <ProfileSkillsFileTree
            v-model="selectedPath"
            :files="treeFiles"
            :badges="fileBadges"
            :flagged="flaggedFiles"
            :is-editable="true"
            :can-rename="canRenameSelected"
            :can-delete="canDeleteSelected"
            :validate-path="validateTreePath"
            @add="addFile"
            @rename="renameSelected"
            @delete="deleteSelected"
          />
        </aside>

        <div
          class="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:min-h-0 sm:overflow-y-auto"
          data-testid="skill-edit-main"
        >
          <ProfileSkillsFrontmatterFields
            v-if="isSkillMdSelected && isFieldsMode && parts"
            v-model:name="nameValue"
            v-model:description="descriptionValue"
            v-model:advanced="advancedValue"
            :name-error="nameError"
            :description-error="descriptionError"
            :problems="problems"
            :catalog-tokens="catalogTokens"
            :is-model-invocable="isModelInvocable"
            @name-blur="checkNameOnBlur"
            @fix="applyProblemFix"
          />
          <p
            v-else-if="isSkillMdSelected && parts"
            class="alert alert-warning alert-soft text-sm"
            role="status"
            data-testid="skill-edit-text-mode"
          >
            The frontmatter of this SKILL.md could not be split into fields.
            Edit the whole file below, starting with the --- block.
          </p>

          <div
            v-if="!isSkillMdSelected && skillMdIssue"
            class="alert alert-error alert-soft"
            role="alert"
            data-testid="skill-edit-skillmd-issue"
          >
            <Icon
              name="lucide:circle-alert"
              size="16"
              class="shrink-0"
              aria-hidden="true"
            />
            <span>SKILL.md needs attention: {{ skillMdIssue }}</span>
            <button
              type="button"
              class="btn btn-sm"
              data-testid="skill-edit-open-skillmd"
              @click="selectFile(SKILL_MD_FILE_NAME)"
            >
              Open SKILL.md
            </button>
          </div>

          <ProfileSkillsEditorPane
            v-model="selectedValueModel"
            :file="selectedFile"
            :is-skill-md="isSkillMdSelected"
            :read-only-reason="selectedReadOnlyReason"
            :problems="paneProblems"
            :findings="selectedScan.findings"
            :finding-counts="selectedScan.counts"
            :catalog-line="isModelInvocable ? catalogLine : ''"
            :catalog-tokens="catalogTokens"
            :body-tokens="bodyTokens"
            @fix="applyProblemFix"
            @retry="retrySelected"
          />
        </div>
      </div>

      <div
        v-if="saveError || saveBlockers.length"
        class="grid shrink-0 gap-1 border-t border-base-300 px-4 py-2 text-sm"
        data-testid="skill-edit-save-issues"
      >
        <div
          v-if="saveError"
          class="alert alert-error alert-soft"
          role="alert"
          data-testid="skill-edit-save-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          <div class="grid gap-0.5">
            <p class="font-medium">
              {{ saveError.message }}
            </p>
            <p v-if="saveError.why">
              {{ saveError.why }}
            </p>
            <p v-if="saveError.fix">
              {{ saveError.fix }}
            </p>
          </div>
        </div>
        <p
          v-for="blocker in saveBlockers"
          :key="blocker"
          class="text-error"
          role="alert"
          data-testid="skill-edit-blocker"
        >
          {{ blocker }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <label class="sr-only" for="skill-edit-note">
          Change note, optional
        </label>
        <input
          id="skill-edit-note"
          v-model="note"
          type="text"
          class="input input-sm w-full min-w-0 sm:w-auto sm:flex-1 sm:basis-56 max-sm:min-h-11"
          :maxlength="SKILL_NOTE_MAX"
          placeholder="Change note (optional)"
          autocomplete="off"
          :disabled="loadState !== 'ready' || isSaving"
          data-testid="skill-edit-note"
        >
        <span
          v-if="isDirty"
          class="text-xs text-base-content/70 max-sm:mr-auto"
          data-testid="skill-edit-dirty"
        >
          Unsaved changes
        </span>
        <button
          type="button"
          class="btn btn-sm max-sm:min-h-11"
          :disabled="isSaving"
          data-testid="skill-edit-cancel"
          @click="dialogRef?.requestClose()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent max-sm:min-h-11"
          :disabled="!canSave"
          data-testid="skill-edit-save"
          @click="onSave"
        >
          <span
            v-if="isSaving"
            class="loading loading-spinner loading-xs"
          />
          Save
        </button>
      </div>
    </template>
  </ProfileSkillsWorkspaceDialog>
</template>

<script setup lang="ts">
import { SKILL_NOTE_MAX } from '#shared/utils/skills-policy'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'

const props = defineProps<{
  skillId: string
}>()

const emit = defineEmits<{
  saved: [result: { id: string, version: number, isRenamed: boolean }]
  close: []
}>()

const dialogRef = useTemplateRef('dialogRef')

const {
  loadState,
  loadError,
  skill,
  baseVersion,
  selectedFile,
  selectedValue,
  selectedReadOnlyReason,
  selectedScan,
  isSkillMdSelected,
  isFieldsMode,
  parts,
  note,
  isSaving,
  isConflict,
  saveError,
  conflictDiff,
  conflictDiffError,
  isComparing,
  isDirty,
  canSave,
  problems,
  saveBlockers,
  nameError,
  descriptionError,
  skillMdIssue,
  canRenameSelected,
  canDeleteSelected,
  treeFiles,
  fileBadges,
  catalogLine,
  catalogTokens,
  bodyTokens,
  load,
  selectFile,
  loadFile,
  setPart,
  setSelectedValue,
  applyProblemFix,
  checkNameOnBlur,
  validatePath,
  addFile,
  renameSelected,
  deleteSelected,
  save,
  compareWithLatest,
} = useSkillEditor(() => props.skillId)

const title = computed<string>(() => {
  return skill.value
    ? `Edit ${getSkillDisplayName(skill.value)} · v${baseVersion.value}`
    : 'Edit skill'
})

const isModelInvocable = computed<boolean>(() => {
  return skill.value?.modelInvocable ?? true
})

const selectedPath = computed<string>({
  get: () => selectedFile.value?.path ?? SKILL_MD_FILE_NAME,
  set: path => selectFile(path),
})

const nameValue = computed<string>({
  get: () => parts.value?.name ?? '',
  set: value => setPart('name', value),
})

const descriptionValue = computed<string>({
  get: () => parts.value?.description ?? '',
  set: value => setPart('description', value),
})

const advancedValue = computed<string>({
  get: () => parts.value?.advanced ?? '',
  set: value => setPart('advanced', value),
})

const selectedValueModel = computed<string>({
  get: () => selectedValue.value,
  set: value => setSelectedValue(value),
})

const flaggedFiles = computed<Record<string, number>>(() => {
  const flagged: Record<string, number> = {}

  if (selectedFile.value && selectedScan.value.findings.length) {
    flagged[selectedFile.value.path] = selectedScan.value.findings.length
  }

  return flagged
})

const paneProblems = computed<SkillEditorProblem[]>(() => {
  return problems.value.filter((problem) => {
    if (problem.scope === 'body') {
      return true
    }

    if (problem.scope !== 'file') {
      return false
    }

    return problem.severity === 'warning' || isSkillMdSelected.value
  })
})

function validateTreePath(
  path: string,
  mode: 'add' | 'rename',
): string | null {
  return validatePath(
    path,
    mode === 'rename' ? selectedFile.value?.key ?? null : null,
  )
}

async function retrySelected() {
  if (selectedFile.value) {
    await loadFile(selectedFile.value.key)
  }
}

async function onReload() {
  if (isDirty.value) {
    const isConfirmed = await useConfirm({
      text: 'Reload the latest version?',
      subtitle: 'Your unsaved edits are discarded.',
      actions: ['Reload'],
      labelDecline: 'Keep editing',
    })

    if (!isConfirmed) {
      return
    }
  }

  await load()
}

async function onSave() {
  const result = await save()

  if (!result.isSaved) {
    return
  }

  if (result.isUnchanged) {
    useSuccessMessage('Nothing changed, so no new version was saved')
  } else {
    useSuccessMessage(`Saved v${result.version}`)
    emit('saved', {
      id: props.skillId,
      version: result.version ?? 0,
      isRenamed: result.isRenamed ?? false,
    })
  }

  dialogRef.value?.forceClose()
}

onMounted(load)
</script>
