<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="memory-import-modal"
      class="js-memory-import-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      @close="onModalClosed"
    >
      <div class="modal-box max-w-2xl max-h-[85dvh] flex flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
            data-testid="memory-import-title"
          >
            Import memory from another assistant
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="memory-import-close"
            >
              <Icon name="lucide:x" size="16" />
            </button>
          </form>
        </div>
        <div class="-me-2 flex-1 min-h-0 overflow-y-auto pe-2">
          <div class="grid gap-5">
            <div
              v-show="phase !== 'done'"
              class="grid gap-5"
              data-testid="memory-import-compose"
            >
              <section
                v-if="phase === 'compose'"
                class="grid gap-2"
              >
                <h4 class="flex items-center gap-2 text-sm font-semibold">
                  <span class="badge badge-neutral badge-sm">1</span>
                  Get your memories out of the other assistant
                </h4>
                <p class="text-sm text-base-content/70">
                  Copy this prompt, send it to the other assistant, then
                  paste its answer below.
                </p>
                <div class="max-h-[min(240px,30dvh)] overflow-y-auto rounded-box bg-base-content/5 p-3">
                  <p
                    class="whitespace-pre-wrap break-words text-sm"
                    data-testid="memory-import-prompt"
                  >
                    {{ prompt }}
                  </p>
                </div>
                <div class="flex justify-end">
                  <UiButton
                    mode="neutral"
                    outline
                    size="sm"
                    normal-case
                    icon-name="lucide:copy"
                    text="Copy prompt"
                    data-testid="memory-import-copy"
                    @click="copyPrompt"
                  />
                </div>
              </section>
              <section class="grid gap-2">
                <h4 class="flex items-center gap-2 text-sm font-semibold">
                  <span class="badge badge-neutral badge-sm">
                    {{ phase === 'partial' ? 'Next' : 2 }}
                  </span>
                  <label :for="textareaId">
                    {{ phase === 'partial'
                      ? 'The part that was not read yet'
                      : 'Paste the answer here' }}
                  </label>
                </h4>
                <textarea
                  :id="textareaId"
                  ref="textarea"
                  v-model="text"
                  class="
                    textarea textarea-bordered rounded-box min-h-48 w-full
                    resize-none max-h-[60dvh] overflow-y-auto
                  "
                  :class="{ 'textarea-error': isOverLimit }"
                  :aria-invalid="isOverLimit"
                  :aria-describedby="counterId"
                  :disabled="isImporting"
                  placeholder="Paste what the other assistant answered"
                  data-testid="memory-import-textarea"
                />
                <p
                  :id="counterId"
                  class="text-xs"
                  :class="isOverLimit ? 'text-error' : 'text-base-content/70'"
                  data-testid="memory-import-counter"
                >
                  {{ text.length }} / {{ maxChars }}
                </p>
              </section>
            </div>
            <section
              v-if="summary"
              class="grid gap-3"
              data-testid="memory-import-summary"
            >
              <h4 class="text-sm font-semibold">
                {{ phase === 'done' ? 'Import finished' : 'So far' }}
              </h4>
              <div
                v-if="phase === 'partial'"
                role="status"
                class="alert alert-soft alert-warning !items-start"
                data-testid="memory-import-truncated"
              >
                <Icon
                  name="lucide:circle-alert"
                  size="20"
                  class="mt-0.5 shrink-0"
                />
                <div class="grid min-w-0 gap-1">
                  <p class="font-bold">Part of your text was not read yet</p>
                  <p class="text-sm">
                    Continue to read the rest. What was already saved is kept.
                  </p>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="rounded-box bg-base-content/5 p-3">
                  <p
                    class="text-xl font-bold"
                    data-testid="memory-import-created"
                  >
                    {{ summary.created }}
                  </p>
                  <p class="text-xs text-base-content/70">Created</p>
                </div>
                <div class="rounded-box bg-base-content/5 p-3">
                  <p
                    class="text-xl font-bold"
                    data-testid="memory-import-updated"
                  >
                    {{ summary.updated }}
                  </p>
                  <p class="text-xs text-base-content/70">Updated</p>
                </div>
                <div class="rounded-box bg-base-content/5 p-3">
                  <p
                    class="text-xl font-bold"
                    data-testid="memory-import-appended"
                  >
                    {{ summary.appended }}
                  </p>
                  <p class="text-xs text-base-content/70">Appended</p>
                </div>
              </div>
              <ul
                v-if="droppedRows.length"
                class="grid gap-1 text-sm"
                data-testid="memory-import-dropped"
              >
                <li
                  v-for="row in droppedRows"
                  :key="row.reason"
                  class="flex items-baseline justify-between gap-3"
                  :data-testid="`memory-import-dropped-${row.reason}`"
                >
                  <span class="min-w-0 break-words">{{ row.label }}</span>
                  <span class="shrink-0 font-semibold">{{ row.count }}</span>
                </li>
              </ul>
              <div
                v-if="blockedRows.length"
                class="grid gap-1"
                data-testid="memory-import-blocked"
              >
                <p class="text-sm font-semibold">
                  Removed before reading (never saved)
                </p>
                <ul class="grid gap-1 text-sm">
                  <li
                    v-for="row in blockedRows"
                    :key="row.kind"
                    class="flex items-baseline justify-between gap-3"
                    :data-testid="`memory-import-blocked-${row.kind}`"
                  >
                    <span class="min-w-0 break-words">{{ row.label }}</span>
                    <span class="shrink-0 font-semibold">{{ row.count }}</span>
                  </li>
                </ul>
              </div>
              <p
                class="text-xs text-base-content/70"
                data-testid="memory-import-meta"
              >
                Read in {{ summary.chunks }}
                {{ summary.chunks === 1 ? 'part' : 'parts' }}
                <template v-if="modelName">
                  with {{ modelName }}
                </template>
              </p>
            </section>
            <div
              v-if="warning"
              role="status"
              class="alert alert-soft alert-warning !items-start"
              data-testid="memory-import-warning"
            >
              <Icon
                name="lucide:clock"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="font-bold break-words">{{ warning.message }}</p>
                <p v-if="warning.why" class="text-sm break-words">
                  {{ warning.why }}
                </p>
              </div>
            </div>
            <div
              v-if="error"
              role="alert"
              class="alert alert-soft alert-error !items-start"
              data-testid="memory-import-error"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="font-bold break-words">{{ error.message }}</p>
                <p v-if="error.why" class="text-sm break-words">
                  {{ error.why }}
                </p>
                <p v-if="error.fix" class="text-sm break-words">
                  {{ error.fix }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-4 flex shrink-0 flex-wrap justify-end gap-2">
          <template v-if="phase === 'done'">
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              normal-case
              text="Import more"
              data-testid="memory-import-more"
              @click="startOver"
            />
            <UiButton
              size="sm"
              normal-case
              text="Done"
              data-testid="memory-import-done"
              @click="open = false"
            />
          </template>
          <template v-else>
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              normal-case
              text="Cancel"
              data-testid="memory-import-cancel"
              @click="open = false"
            />
            <UiButton
              size="sm"
              normal-case
              :text="submitText"
              :disabled="isSubmitDisabled"
              :data-testid="phase === 'partial'
                ? 'memory-import-continue'
                : 'memory-import-submit'"
              @click="runImport"
            >
              <template
                v-if="isImporting"
                #icon
              >
                <span class="loading loading-spinner loading-xs" />
              </template>
            </UiButton>
          </template>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { MEMORY_IMPORT_MAX_CHARS } from '#shared/utils/memory-import-limits'
import { MEMORY_IMPORT_PROMPT } from '#shared/utils/memory-import-prompt'
import { neverStoreKinds } from '#shared/utils/memory-policy'

type ParsedError = ReturnType<typeof parseError>
type ImportPhase = 'compose' | 'partial' | 'done'

interface ImportSummary {
  created: number
  updated: number
  appended: number
  dropped: Record<string, number>
  blocked: Record<string, number>
  chunks: number
  model: { source: string | null, modelId: string } | null
}

interface ImportWarning {
  message: string
  why: string | null
}

const emit = defineEmits<{
  changed: []
}>()

const open = defineModel<boolean>('open', { default: false })

const COOLDOWN_STATUS = 429
const COOLDOWN_MESSAGE = 'Wait a minute before importing again'
const COOLDOWN_WHY = 'An import was requested less than a minute ago.'

const droppedReasonLabels: Record<string, string> = {
  'sensitive-topic': 'Sensitive topics (never saved)',
  'never-store': 'Private data (never saved)',
  'duplicate': 'Already remembered',
  'ungrounded': 'No supporting detail',
}

const blockedKindLabels: Record<string, string> = Object.fromEntries(
  neverStoreKinds.map(kind => [kind.id, kind.label]),
)

const prompt = MEMORY_IMPORT_PROMPT
const maxChars = MEMORY_IMPORT_MAX_CHARS

const headingId = useId()
const textareaId = useId()
const counterId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const text = shallowRef<string>('')
const { textarea } = useTextareaAutosize({ input: text })
const phase = shallowRef<ImportPhase>('compose')
const isImporting = shallowRef<boolean>(false)
const summary = shallowRef<ImportSummary | null>(null)
const error = shallowRef<ParsedError | null>(null)
const warning = shallowRef<ImportWarning | null>(null)

const isOverLimit = computed<boolean>(() => {
  return text.value.length > MEMORY_IMPORT_MAX_CHARS
})

const isSubmitDisabled = computed<boolean>(() => {
  return isImporting.value
    || isOverLimit.value
    || text.value.trim() === ''
})

const submitText = computed<string>(() => {
  if (isImporting.value) {
    return 'Importing...'
  }

  return phase.value === 'partial' ? 'Continue' : 'Import'
})

const droppedRows = computed(() => {
  return Object.entries(summary.value?.dropped ?? {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => {
      return { reason, count, label: droppedReasonLabels[reason] ?? reason }
    })
})

const blockedRows = computed(() => {
  return Object.entries(summary.value?.blocked ?? {})
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      return { kind, count, label: blockedKindLabels[kind] ?? kind }
    })
})

const modelName = computed<string | null>(() => {
  const model = summary.value?.model

  if (!model) {
    return null
  }

  return getModel(model.modelId).model?.name ?? model.modelId
})

function addCounts(
  current: Record<string, number>,
  incoming: Record<string, number | undefined>,
): Record<string, number> {
  const merged = { ...current }

  for (const [key, count] of Object.entries(incoming)) {
    merged[key] = (merged[key] ?? 0) + (count ?? 0)
  }

  return merged
}

function readRetryAfterSeconds(exception: unknown): number | null {
  const headers = (exception as {
    response?: { headers?: { get?: (name: string) => string | null } }
  } | null)?.response?.headers
  const header = headers?.get?.('retry-after')
  const seconds = Number(header)

  if (!header || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return Math.ceil(seconds)
}

function describeCooldown(exception: unknown): ImportWarning {
  const seconds = readRetryAfterSeconds(exception)

  if (seconds === null) {
    return { message: COOLDOWN_MESSAGE, why: COOLDOWN_WHY }
  }

  return {
    message: COOLDOWN_MESSAGE,
    why: `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
  }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(MEMORY_IMPORT_PROMPT)

    useSuccessMessage('Copied')
  } catch (exception) {
    useErrorMessage(
      'Failed to copy the prompt',
      parseError(exception).message,
    )
  }
}

function requestImport(submittedText: string) {
  return $fetch('/api/v1/memory/import', {
    method: 'POST',
    body: { text: submittedText },
  })
}

type ImportResponse = Awaited<ReturnType<typeof requestImport>>

function applyResponse(response: ImportResponse, submittedText: string) {
  const previous = summary.value

  summary.value = {
    created: (previous?.created ?? 0) + response.created,
    updated: (previous?.updated ?? 0) + response.updated,
    appended: (previous?.appended ?? 0) + response.appended,
    dropped: addCounts(previous?.dropped ?? {}, response.dropped),
    blocked: previous
      ? previous.blocked
      : addCounts({}, response.blocked),
    chunks: (previous?.chunks ?? 0) + response.chunks,
    model: response.model ?? previous?.model ?? null,
  }

  const remainder = submittedText.slice(response.consumedChars)

  if (response.truncated && remainder.trim() !== '') {
    text.value = remainder
    phase.value = 'partial'

    return
  }

  text.value = ''
  phase.value = 'done'
}

const { ensureSendConsent, handleConsentError } = useLegalConsent()

async function runImport() {
  if (isSubmitDisabled.value) {
    return
  }

  if (!await ensureSendConsent(null)) {
    return
  }

  const submittedText = text.value

  isImporting.value = true
  error.value = null
  warning.value = null

  try {
    const response = await requestImport(submittedText)

    applyResponse(response, submittedText)

    if (response.created + response.updated + response.appended > 0) {
      emit('changed')
    }
  } catch (exception) {
    if (await handleConsentError(exception)) {
      return
    }

    const parsedException = parseError(exception)

    if (parsedException.status === COOLDOWN_STATUS) {
      warning.value = describeCooldown(exception)

      return
    }

    error.value = parsedException
  } finally {
    isImporting.value = false
  }
}

function startOver() {
  summary.value = null
  error.value = null
  warning.value = null
  text.value = ''
  phase.value = 'compose'
}

function onModalClosed() {
  open.value = false
  error.value = null
  warning.value = null

  if (isImporting.value) {
    return
  }

  if (phase.value === 'done') {
    startOver()
  }
}

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    modal.value.showModal()

    return
  }

  modal.value.close()
}, { immediate: true, flush: 'post' })
</script>
