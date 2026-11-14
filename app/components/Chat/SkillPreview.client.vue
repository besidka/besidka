<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="js-skill-preview modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="skill-preview-dialog"
      @close="onDialogClose"
    >
      <div
        ref="boxRef"
        tabindex="-1"
        autofocus
        class="modal-box sheet-safe-padding flex max-w-2xl flex-col outline-none max-sm:max-h-[85dvh] sm:max-h-[80dvh]"
      >
        <div class="mb-3 flex shrink-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <h3
              :id="headingId"
              class="flex items-center gap-2 text-lg font-bold"
            >
              <Icon
                name="lucide:sparkles"
                size="18"
                class="shrink-0 text-accent"
                aria-hidden="true"
              />
              <span
                class="truncate"
                data-testid="skill-preview-name"
              >
                {{ skill?.name ?? 'Skill' }}
              </span>
            </h3>
            <p
              v-if="skill"
              class="mt-1 text-sm text-base-content/70 break-words"
              data-testid="skill-preview-description"
            >
              {{ skill.description }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close"
            data-testid="skill-preview-close"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
            />
          </button>
        </div>

        <div
          v-if="loadState === 'loading'"
          class="grid gap-2"
          role="status"
          aria-label="Loading the skill"
          data-testid="skill-preview-loading"
        >
          <div class="skeleton skeleton--default h-6 w-1/2" />
          <div class="skeleton skeleton--default h-48 w-full" />
        </div>
        <div
          v-else-if="loadState === 'error'"
          class="alert alert-warning alert-soft"
          role="alert"
          data-testid="skill-preview-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          <span>{{ errorMessage }}</span>
          <NuxtLink
            to="/profile/skills"
            class="btn btn-sm"
            @click="close"
          >
            All skills
          </NuxtLink>
        </div>
        <template v-else-if="skill">
          <div
            class="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-xs"
          >
            <span
              class="badge badge-soft badge-sm"
              data-testid="skill-preview-mode"
            >
              {{ SKILL_MODE_LABELS[mode] }}
            </span>
            <span class="text-base-content/70">
              {{ SKILL_MODE_DESCRIPTIONS[mode] }}
            </span>
          </div>
          <pre
            class="min-h-0 flex-1 overflow-auto rounded-box border border-base-300 bg-base-200 p-3 font-mono text-xs whitespace-pre-wrap break-words"
            tabindex="0"
            aria-label="SKILL.md"
            data-testid="skill-preview-text"
          >{{ text }}</pre>
          <p
            v-if="isTruncated"
            class="mt-2 text-xs text-base-content/70"
            data-testid="skill-preview-truncated"
          >
            Showing the start of the file. Open the editor to read all of it.
          </p>
        </template>

        <div class="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <NuxtLink
            to="/profile/skills"
            class="link link-hover text-sm"
            data-testid="skill-preview-all"
            @click="close"
          >
            All skills
          </NuxtLink>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-sm max-sm:min-h-11"
              data-testid="skill-preview-dismiss"
              @click="close"
            >
              Close
            </button>
            <button
              type="button"
              class="btn btn-sm btn-accent max-sm:min-h-11"
              :disabled="!skill"
              data-testid="skill-preview-edit"
              @click="onEdit"
            >
              <Icon
                name="lucide:pencil"
                size="14"
                aria-hidden="true"
              />
              Edit
            </button>
          </div>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  SKILL_MODE_DESCRIPTIONS,
  SKILL_MODE_LABELS,
  getSkillMode,
} from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { SkillSummary } from '#shared/types/skills.d'

const PREVIEW_TEXT_MAX_CHARS = 60_000
const DIALOG_READY_TIMEOUT_MS = 1000

const props = defineProps<{
  skillId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const headingId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const boxRef = useTemplateRef<HTMLDivElement>('boxRef')

const loadState = shallowRef<'loading' | 'ready' | 'error'>('loading')
const errorMessage = shallowRef<string>('')
const skill = shallowRef<SkillSummary | null>(null)
const text = shallowRef<string>('')
const isTruncated = shallowRef<boolean>(false)

const mode = computed<SkillMode>(() => {
  return skill.value ? getSkillMode(skill.value) : 'off'
})

async function load() {
  loadState.value = 'loading'

  try {
    const detail = await $fetch(`/api/v1/skills/${props.skillId}`)
    const file = await $fetch(`/api/v1/skills/${props.skillId}/files`, {
      query: { path: SKILL_MD_FILE_NAME },
    })
    const fileText = 'text' in file && typeof file.text === 'string'
      ? file.text
      : ''

    skill.value = detail
    isTruncated.value = fileText.length > PREVIEW_TEXT_MAX_CHARS
    text.value = isTruncated.value
      ? fileText.slice(0, PREVIEW_TEXT_MAX_CHARS)
      : fileText
    loadState.value = 'ready'
  } catch (exception) {
    errorMessage.value = parseError(exception).message
      || 'This skill is not available any more.'
    loadState.value = 'error'
  }
}

async function showDialog() {
  const dialog = await until(dialogRef).toBeTruthy({
    timeout: DIALOG_READY_TIMEOUT_MS,
    throwOnTimeout: false,
  })

  if (!dialog || dialog.open) {
    return
  }

  dialog.showModal()
  boxRef.value?.focus({ preventScroll: true })
}

function close() {
  if (dialogRef.value?.open) {
    dialogRef.value.close()

    return
  }

  emit('close')
}

function onDialogClose() {
  emit('close')
}

async function onEdit() {
  if (!skill.value) {
    return
  }

  const id = skill.value.id

  close()
  await navigateTo({
    path: '/profile/skills',
    query: { skill: id, edit: '1' },
  })
}

onMounted(async () => {
  await showDialog()
  await load()
})
</script>
