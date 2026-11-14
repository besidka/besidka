<template>
  <ProfileSkillsWorkspaceDialog
    :title="dialogTitle"
    :size="step === 'review' ? 'workspace' : 'form'"
    :is-busy="step === 'working' || isCommitting"
    hook-class="js-skill-import-modal"
    @close="emit('close')"
  >
    <div
      v-if="step === 'input' || step === 'working'"
      class="grid gap-4"
    >
      <div
        class="tabs tabs-box tabs-sm w-full"
        role="tablist"
        aria-label="Where the skill comes from"
      >
        <button
          v-for="option in tabOptions"
          :id="`skill-import-tab-${option.id}`"
          :key="option.id"
          type="button"
          role="tab"
          class="tab grow min-h-11 sm:min-h-8"
          :class="{ 'tab-active': tab === option.id }"
          :aria-selected="tab === option.id"
          :aria-controls="`skill-import-panel-${option.id}`"
          :tabindex="tab === option.id ? 0 : -1"
          :disabled="step === 'working'"
          :data-testid="`skill-import-tab-${option.id}`"
          @click="onSelectTab(option.id)"
          @keydown="onTabKeydown"
        >
          {{ option.label }}
        </button>
      </div>

      <div
        :id="`skill-import-panel-${tab}`"
        role="tabpanel"
        :aria-labelledby="`skill-import-tab-${tab}`"
        class="grid gap-3"
      >
        <template v-if="tab === 'upload'">
          <label
            for="skill-import-file"
            class="text-sm font-medium"
          >
            Skill archive
          </label>
          <input
            id="skill-import-file"
            type="file"
            class="file-input file-input-sm w-full"
            accept=".zip,.skill"
            :disabled="step === 'working'"
            aria-describedby="skill-import-file-help"
            data-testid="skill-import-file"
            @change="onFileChange"
          >
          <p
            id="skill-import-file-help"
            class="text-xs text-base-content/70"
          >
            A .zip or .skill file up to 5 MiB. Besidka checks it in your
            browser first, then again on the server.
          </p>
        </template>
        <template v-else-if="tab === 'paste'">
          <label
            for="skill-import-text"
            class="text-sm font-medium"
          >
            SKILL.md
          </label>
          <textarea
            id="skill-import-text"
            v-model="pastedText"
            class="textarea w-full font-mono text-xs"
            rows="10"
            spellcheck="false"
            :placeholder="PASTE_PLACEHOLDER"
            :disabled="step === 'working'"
            data-testid="skill-import-text"
          />
        </template>
        <template v-else>
          <label
            for="skill-import-url"
            class="text-sm font-medium"
          >
            GitHub link
          </label>
          <input
            id="skill-import-url"
            v-model="githubUrl"
            type="url"
            class="input w-full"
            placeholder="https://github.com/owner/repo/tree/main/skills/name"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            aria-describedby="skill-import-url-help"
            :disabled="step === 'working'"
            data-testid="skill-import-url"
            @keydown.enter.prevent="onSubmit"
          >
          <p
            id="skill-import-url-help"
            class="text-xs text-base-content/70"
          >
            A link to a public repository or to a skill folder. The skill is
            pinned to the commit it is read from.
          </p>
        </template>

        <div
          v-if="errorMessage"
          class="alert alert-error alert-soft items-start"
          role="alert"
          data-testid="skill-import-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="16"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div class="grid gap-0.5 text-sm">
            <p class="font-medium">
              {{ errorMessage }}
            </p>
            <p
              v-for="hint in errorHints"
              :key="hint"
              data-testid="skill-import-error-hint"
            >
              {{ hint }}
            </p>
          </div>
        </div>

        <div
          v-if="step === 'working'"
          class="flex items-start gap-3 rounded-box bg-base-200 p-3 text-sm"
          role="status"
          data-testid="skill-import-working"
        >
          <span class="loading loading-spinner loading-sm mt-0.5 shrink-0" />
          <div class="grid gap-0.5">
            <p class="font-medium">
              Checking on the server...
            </p>
            <p v-if="workerSummary">
              {{ workerSummary.name }}:
              {{ workerSummary.files.length }}
              {{ workerSummary.files.length === 1 ? 'file' : 'files' }},
              {{ getSkillLicenceLabel(workerSummary.licenceClass) }}.
            </p>
          </div>
        </div>
      </div>
    </div>

    <fieldset
      v-else-if="step === 'pick' && pick"
      class="grid gap-3"
      data-testid="skill-import-pick"
    >
      <legend class="text-sm">
        This repository has {{ pick.total }} skills. Choose which to import.
        <template v-if="pick.truncated">
          Only the first {{ pick.max }} are listed.
        </template>
      </legend>
      <label
        v-for="candidate in pick.candidates"
        :key="candidate.path"
        class="flex min-h-11 cursor-pointer items-center gap-3 rounded-box border border-base-300 px-3 py-2 has-checked:border-accent has-checked:bg-base-200"
      >
        <input
          v-model="pickedPaths"
          type="checkbox"
          class="checkbox checkbox-sm"
          :value="candidate.path"
          :disabled="!pickedPaths.includes(candidate.path)
            && pickedPaths.length >= pick.max"
          data-testid="skill-import-pick-item"
        >
        <span class="grid min-w-0">
          <span class="truncate text-sm font-medium">{{ candidate.name }}</span>
          <span class="truncate font-mono text-xs text-base-content/70">
            {{ candidate.path }}
          </span>
        </span>
      </label>
      <p
        v-if="errorMessage"
        class="text-sm text-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
    </fieldset>

    <div
      v-else-if="step === 'review' && preview"
      class="grid gap-4"
    >
      <p
        v-if="queueTotal > 1"
        class="text-sm text-base-content/70"
        data-testid="skill-import-queue"
      >
        Skill {{ queueIndex + 1 }} of {{ queueTotal }}
      </p>

      <div
        v-if="collision"
        class="alert alert-warning alert-soft items-start"
        role="alert"
        data-testid="skill-import-collision"
      >
        <Icon
          name="lucide:triangle-alert"
          size="18"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div class="grid w-full gap-3 text-sm">
          <p class="font-medium">
            A skill named {{ collision.name }} exists.
          </p>
          <div class="grid gap-2">
            <p>
              Replace it as an update: the incoming files become a pending
              version you review, and your current version keeps running
              until you accept it.
            </p>
            <div>
              <button
                type="button"
                class="btn btn-sm"
                :disabled="isCommitting || !canInstall"
                data-testid="skill-import-replace"
                @click="onCommit({ asUpdateOf: collision.asUpdateOf })"
              >
                Replace as an update
              </button>
            </div>
          </div>
          <form
            class="grid gap-2"
            @submit.prevent="onCommit({ name: renamedName.trim() })"
          >
            <label
              for="skill-import-rename"
              class="font-medium"
            >
              Or import under a new name
            </label>
            <div class="join w-full">
              <input
                id="skill-import-rename"
                v-model="renamedName"
                type="text"
                class="input input-sm join-item w-full text-base-content"
                :maxlength="SKILL_NAME_MAX"
                autocapitalize="none"
                autocomplete="off"
                spellcheck="false"
                data-testid="skill-import-rename"
              >
              <button
                type="submit"
                class="btn btn-sm join-item"
                :disabled="isCommitting
                  || !canInstall
                  || !isSkillNameValid(renamedName.trim())"
                data-testid="skill-import-rename-submit"
              >
                Import
              </button>
            </div>
          </form>
        </div>
      </div>

      <p
        v-if="errorMessage"
        class="text-sm text-error"
        role="alert"
        data-testid="skill-import-commit-error"
      >
        {{ errorMessage }}
      </p>

      <ProfileSkillsReview
        :preview="preview"
        :read-file="readArchiveFile"
        :file-name="file?.name ?? null"
      />
    </div>

    <template #footer>
      <template v-if="step === 'review' && preview">
        <div class="mr-auto grid gap-1 text-sm max-sm:basis-full">
          <label class="flex min-h-8 cursor-pointer items-center gap-2">
            <input
              v-model="isReviewed"
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="skill-import-reviewed"
            >
            I reviewed this skill
          </label>
          <label
            v-if="preview.requiresLicenceAcknowledgement"
            class="flex min-h-8 cursor-pointer items-center gap-2"
          >
            <input
              v-model="isLicenceAcknowledged"
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="skill-import-licence"
            >
            {{ licenceTickLabel }}
          </label>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isCommitting"
          data-testid="skill-import-cancel"
          @click="onCancelReview"
        >
          {{ queueIndex + 1 < queueTotal ? 'Skip' : 'Cancel' }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          :disabled="!canInstall || isCommitting"
          data-testid="skill-import-install"
          @click="onCommit({})"
        >
          <span
            v-if="isCommitting"
            class="loading loading-spinner loading-xs"
          />
          Install (disabled)
        </button>
      </template>
      <template v-else-if="step === 'pick'">
        <button
          type="button"
          class="btn btn-sm"
          data-testid="skill-import-pick-back"
          @click="step = 'input'"
        >
          Back
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          :disabled="!pickedPaths.length"
          data-testid="skill-import-pick-review"
          @click="onReviewPicked"
        >
          Review {{ pickedPaths.length || '' }}
          {{ pickedPaths.length === 1 ? 'skill' : 'skills' }}
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="step === 'working'"
          data-testid="skill-import-input-cancel"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          :disabled="!canSubmit || step === 'working'"
          data-testid="skill-import-submit"
          @click="onSubmit"
        >
          <span
            v-if="step === 'working'"
            class="loading loading-spinner loading-xs"
          />
          Review
        </button>
      </template>
    </template>
  </ProfileSkillsWorkspaceDialog>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import {
  SKILL_NAME_MAX,
  isSkillNameValid,
} from '#shared/utils/skills-policy'
import type {
  SkillGithubPick,
  SkillImportCommitResponse,
  SkillImportPreview,
  SkillImportPreviewResponse,
} from '#shared/types/skills.d'
import type { SkillImportWorkerSummary } from '~/types/skill-import.d'
import type { SkillImportTab } from '~/types/skills-ui.d'

type ImportStep = 'input' | 'working' | 'pick' | 'review'

interface TabOption {
  id: SkillImportTab
  label: string
}

const PASTE_PLACEHOLDER
  = '---\nname: my-skill\ndescription: What it does\n---'

interface Collision {
  stageId: string
  asUpdateOf: string
  name: string
}

const props = withDefaults(defineProps<{
  initialTab?: SkillImportTab
  canImportFromUrl?: boolean
}>(), {
  initialTab: 'upload',
  canImportFromUrl: false,
})

const emit = defineEmits<{
  installed: [skill: {
    kind: 'created' | 'pending'
    id: string
    name: string
  }]
  close: []
}>()

const inspector = useSkillArchiveInspector()

const tab = shallowRef<SkillImportTab>(
  props.initialTab === 'github' && !props.canImportFromUrl
    ? 'upload'
    : props.initialTab,
)
const step = shallowRef<ImportStep>('input')
const errorMessage = shallowRef<string>('')
const errorHints = shallowRef<string[]>([])
const file = shallowRef<File | null>(null)
const pastedText = shallowRef<string>('')
const githubUrl = shallowRef<string>('')
const workerSummary = shallowRef<SkillImportWorkerSummary | null>(null)
const preview = shallowRef<SkillImportPreview | null>(null)
const pick = shallowRef<SkillGithubPick['pick'] | null>(null)
const pickedPaths = shallowRef<string[]>([])
const queue = shallowRef<string[]>([])
const queueIndex = shallowRef<number>(0)
const queueTotal = shallowRef<number>(0)
const isReviewed = shallowRef<boolean>(false)
const isLicenceAcknowledged = shallowRef<boolean>(false)
const isCommitting = shallowRef<boolean>(false)
const collision = shallowRef<Collision | null>(null)
const renamedName = shallowRef<string>('')
const archiveTexts = shallowRef<Map<string, string> | null>(null)

const tabOptions = computed<TabOption[]>(() => {
  const options: TabOption[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'paste', label: 'Paste' },
  ]

  if (props.canImportFromUrl) {
    options.push({ id: 'github', label: 'GitHub' })
  }

  return options
})

const dialogTitle = computed<string>(() => {
  if (step.value === 'review' && preview.value) {
    return `Review ${preview.value.skill.name}`
  }

  return step.value === 'pick' ? 'Choose skills' : 'Add a skill'
})

const canSubmit = computed<boolean>(() => {
  if (tab.value === 'upload') {
    return !!file.value
  }

  if (tab.value === 'paste') {
    return !!pastedText.value.trim()
  }

  return !!githubUrl.value.trim()
})

const canInstall = computed<boolean>(() => {
  if (!preview.value || !isReviewed.value) {
    return false
  }

  return !preview.value.requiresLicenceAcknowledgement
    || isLicenceAcknowledged.value
})

const licenceTickLabel = computed<string>(() => {
  return preview.value?.licence.class === 'none'
    ? 'I have the right to use this skill'
    : 'I read the licence and may use this skill'
})

function clearError() {
  errorMessage.value = ''
  errorHints.value = []
}

function showError(exception: unknown, fallback: string) {
  const parsedException = parseError(exception)

  errorMessage.value = parsedException.message || fallback
  errorHints.value = [parsedException.why, parsedException.fix].filter(
    (hint): hint is string => !!hint,
  )
}

function onSelectTab(next: SkillImportTab) {
  tab.value = next
  clearError()
}

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }

  const options = tabOptions.value
  const currentIndex = options.findIndex(option => option.id === tab.value)
  const step = event.key === 'ArrowRight' ? 1 : -1
  const next = options[(currentIndex + step + options.length) % options.length]!

  event.preventDefault()
  onSelectTab(next.id)
  await nextTick()
  document.getElementById(`skill-import-tab-${next.id}`)?.focus()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement

  file.value = input.files?.[0] ?? null
  clearError()
  workerSummary.value = null
}

function resetReview() {
  preview.value = null
  isReviewed.value = false
  isLicenceAcknowledged.value = false
  collision.value = null
  archiveTexts.value = null
}

function applyPreview(response: SkillImportPreviewResponse) {
  if ('pick' in response) {
    pick.value = response.pick
    pickedPaths.value = []
    step.value = 'pick'

    return
  }

  resetReview()
  preview.value = response
  renamedName.value = response.skill.name
  step.value = 'review'
}

async function previewUpload() {
  const selected = file.value

  if (!selected) {
    return
  }

  const inspected = await inspector.inspect(selected)

  if (inspected && !inspected.ok) {
    errorMessage.value = inspected.message
    errorHints.value = inspected.path ? [inspected.path] : []
    step.value = 'input'

    return
  }

  workerSummary.value = inspected?.ok ? inspected.summary : null

  const body = new FormData()

  body.append('file', selected)

  applyPreview(await $fetch('/api/v1/skills/import/preview', {
    method: 'POST',
    body,
  }))
}

async function onSubmit() {
  if (!canSubmit.value || step.value === 'working') {
    return
  }

  clearError()
  step.value = 'working'

  try {
    if (tab.value === 'upload') {
      await previewUpload()
    } else if (tab.value === 'paste') {
      applyPreview(await $fetch('/api/v1/skills/import/text', {
        method: 'POST',
        body: { text: pastedText.value },
      }))
    } else {
      applyPreview(await $fetch('/api/v1/skills/import/preview', {
        method: 'POST',
        body: { url: githubUrl.value.trim() },
      }))
    }
  } catch (exception) {
    showError(exception, 'The skill could not be checked.')
    step.value = 'input'
  }
}

async function loadQueued(path: string) {
  clearError()
  step.value = 'working'

  try {
    const response = await $fetch('/api/v1/skills/import/preview', {
      method: 'POST',
      body: { url: githubUrl.value.trim(), path },
    })

    applyPreview(response)
  } catch (exception) {
    showError(exception, 'The skill could not be checked.')
    step.value = queue.value.length ? 'pick' : 'input'
  }
}

async function onReviewPicked() {
  queue.value = [...pickedPaths.value]
  queueTotal.value = queue.value.length
  queueIndex.value = 0

  await loadQueued(queue.value[0]!)
}

async function advanceQueue() {
  const nextIndex = queueIndex.value + 1

  if (nextIndex >= queueTotal.value) {
    emit('close')

    return
  }

  queueIndex.value = nextIndex
  await loadQueued(queue.value[nextIndex]!)
}

async function onCancelReview() {
  if (queueIndex.value + 1 < queueTotal.value) {
    await advanceQueue()

    return
  }

  emit('close')
}

async function onCommit(
  extra: { asUpdateOf?: string, name?: string },
) {
  const current = preview.value

  if (!current || !canInstall.value || isCommitting.value) {
    return
  }

  isCommitting.value = true
  clearError()

  try {
    const result: SkillImportCommitResponse = await $fetch(
      '/api/v1/skills/import/commit',
      {
        method: 'POST',
        body: {
          stageId: current.stageId,
          acknowledged: true,
          ...(current.requiresLicenceAcknowledgement
            ? { licenceAcknowledged: true }
            : {}),
          ...extra,
        },
      },
    )

    emit('installed', {
      kind: result.kind,
      id: result.id,
      name: result.name,
    })
    await advanceQueue()
  } catch (exception) {
    const parsedException = parseError(exception)
    const data = parsedException.data as Partial<Collision> | undefined

    if (parsedException.code === 'name-taken' && data?.asUpdateOf) {
      collision.value = {
        stageId: current.stageId,
        asUpdateOf: data.asUpdateOf,
        name: data.name ?? current.skill.name,
      }
      errorMessage.value = ''
    } else if (parsedException.code === 'stage-not-found') {
      resetReview()
      step.value = 'input'
      errorMessage.value = 'This import has expired.'
      errorHints.value = ['Upload the skill again.']
    } else {
      showError(exception, 'The skill could not be installed.')
    }
  } finally {
    isCommitting.value = false
  }
}

function readArchiveFile(path: string): string | null {
  if (tab.value !== 'upload' || !file.value) {
    return null
  }

  return archiveTexts.value?.get(path) ?? null
}

watch(preview, async (current) => {
  if (!current || tab.value !== 'upload' || !file.value) {
    return
  }

  const bytes = new Uint8Array(await file.value.arrayBuffer())
  const archive = extractSkillArchive(bytes)

  if (!archive.ok) {
    return
  }

  archiveTexts.value = new Map(archive.files.map((entry) => {
    return [entry.path, entry.text]
  }))
})
</script>
