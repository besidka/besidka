<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-knowledge-item-sheet modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="knowledge-item-sheet"
      @close="onModalClosed"
    >
      <div class="modal-box flex max-h-[85dvh] max-w-2xl flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
            data-testid="knowledge-item-sheet-title"
          >
            {{ itemName }}
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="knowledge-item-sheet-close"
            >
              <Icon
                name="lucide:x"
                size="16"
              />
            </button>
          </form>
        </div>
        <div
          v-if="item"
          class="-me-2 min-h-0 flex-1 overflow-y-auto pe-2"
        >
          <div class="grid gap-5">
            <dl
              class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
              data-testid="knowledge-item-sheet-meta"
            >
              <dt class="text-base-content/60">Type</dt>
              <dd data-testid="knowledge-item-sheet-type">
                {{ typeLabel }}
              </dd>
              <dt class="text-base-content/60">Size</dt>
              <dd data-testid="knowledge-item-sheet-size">
                {{ sizeLabel }}
              </dd>
              <template v-if="tokens !== null && tokens > 0">
                <dt class="text-base-content/60">Context</dt>
                <dd data-testid="knowledge-item-sheet-tokens">
                  ~{{ formatApproxTokens(tokens) }} tokens for {{ modelName }}
                </dd>
              </template>
              <dt class="text-base-content/60">Status</dt>
              <dd data-testid="knowledge-item-sheet-status">
                {{ statusLabel }}
              </dd>
            </dl>
            <div
              v-if="item.extractStatus !== 'ready'"
              role="status"
              class="alert alert-soft !items-start"
              :class="item.extractStatus === 'failed'
                ? 'alert-error'
                : 'alert-warning'"
              data-testid="knowledge-item-sheet-extract-message"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="break-words">{{ extractMessage }}</p>
                <p
                  v-if="item.extractStatus === 'failed'"
                  class="text-sm"
                >
                  Remove it, then add the file again.
                </p>
              </div>
            </div>
            <div class="grid gap-1">
              <label
                class="text-sm font-semibold"
                :for="descriptionId"
              >
                Description
              </label>
              <input
                :id="descriptionId"
                v-model="draftDescription"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isDescriptionOverLimit }"
                :aria-invalid="isDescriptionOverLimit"
                :aria-describedby="descriptionCounterId"
                :disabled="isSaving"
                placeholder="A short line about what this is"
                data-testid="knowledge-item-sheet-description"
                @input="saveError = null"
              >
              <p
                :id="descriptionCounterId"
                class="text-xs"
                :class="isDescriptionOverLimit
                  ? 'text-error'
                  : 'text-base-content/70'"
                data-testid="knowledge-item-sheet-counter"
              >
                {{ normalizedDescription.length }}
                / {{ KNOWLEDGE_LIMITS.maxDescriptionChars }}
              </p>
            </div>
            <section
              v-if="isPdfSectionVisible"
              class="grid gap-2"
              data-testid="knowledge-item-sheet-pdf"
            >
              <h4 class="text-sm font-semibold">
                {{ item.extractStatus === 'no-text'
                  ? 'This PDF has no readable text'
                  : 'PDF options' }}
              </h4>
              <label
                v-if="isNativePdfToggleVisible"
                class="flex cursor-pointer items-start gap-3"
              >
                <input
                  v-model="draftSendAsNativePdf"
                  type="checkbox"
                  class="toggle toggle-sm mt-0.5"
                  :disabled="isSaving"
                  data-testid="knowledge-item-sheet-native-pdf"
                  @change="saveError = null"
                >
                <span class="grid gap-1">
                  <span class="font-medium">
                    Send as PDF, with images, to models that read PDFs
                  </span>
                  <span class="text-sm text-base-content/70">
                    The original pages are attached, at about
                    {{ KNOWLEDGE_LIMITS.nativePdfPageTokens.toLocaleString() }}
                    tokens per page. Other models get the extracted text.
                  </span>
                </span>
              </label>
              <p
                v-else
                class="text-sm text-base-content/70"
                data-testid="knowledge-item-sheet-pdf-hint"
              >
                {{ modelName }} does not read PDFs. Pick a chat model that
                does to send this file as a PDF, with its images.
              </p>
              <p
                v-if="item.extractStatus === 'no-text'"
                class="text-sm text-base-content/70"
                data-testid="knowledge-item-sheet-transcribe"
              >
                Transcribing scanned pages with a model is coming soon.
              </p>
            </section>
            <div
              v-if="saveError"
              role="alert"
              class="alert alert-soft alert-error !items-start"
              data-testid="knowledge-item-sheet-error"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="break-words font-bold">{{ saveError.message }}</p>
                <p
                  v-if="saveError.why"
                  class="break-words text-sm"
                >
                  {{ saveError.why }}
                </p>
                <p
                  v-if="saveError.fix"
                  class="break-words text-sm"
                >
                  {{ saveError.fix }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div
          class="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2"
        >
          <UiButton
            mode="error"
            outline
            size="sm"
            icon-name="lucide:trash-2"
            text="Remove"
            normal-case
            :disabled="isSaving || !item"
            data-testid="knowledge-item-sheet-remove"
            @click="emitRemove"
          />
          <div class="flex gap-2">
            <UiButton
              v-if="item?.extractStatus === 'failed'"
              mode="neutral"
              outline
              size="sm"
              text="Remove and add again"
              normal-case
              :disabled="isSaving"
              data-testid="knowledge-item-sheet-readd"
              @click="emitReadd"
            />
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              text="Cancel"
              normal-case
              :disabled="isSaving"
              data-testid="knowledge-item-sheet-cancel"
              @click="open = false"
            />
            <UiButton
              size="sm"
              normal-case
              :text="isSaving ? 'Saving...' : 'Save'"
              :disabled="isSaveDisabled"
              data-testid="knowledge-item-sheet-save"
              @click="save"
            />
          </div>
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
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { formatApproxTokens } from '#shared/utils/prompt-cache-estimate'
import type {
  KnowledgeItemPatchInput,
  ProjectKnowledgeError,
  ProjectKnowledgeOutcome,
} from '~/types/project-knowledge.d'

const props = defineProps<{
  item: KnowledgeItem | null
  tokens: number | null
  modelName: string
  canSendPdf: boolean
  patchItem: (
    id: string,
    patch: KnowledgeItemPatchInput,
  ) => Promise<ProjectKnowledgeOutcome<unknown>>
}>()

const emit = defineEmits<{
  remove: [item: KnowledgeItem]
  readd: [item: KnowledgeItem]
}>()

const open = defineModel<boolean>('open', { default: false })

const headingId = useId()
const descriptionId = useId()
const descriptionCounterId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const draftDescription = shallowRef<string>('')
const draftSendAsNativePdf = shallowRef<boolean>(false)
const isSaving = shallowRef<boolean>(false)
const saveError = shallowRef<ProjectKnowledgeError | null>(null)

const itemName = computed<string>(() => {
  return props.item ? getKnowledgeItemName(props.item) : 'Knowledge item'
})

const typeLabel = computed<string>(() => {
  return props.item ? getKnowledgeItemTypeLabel(props.item) : ''
})

const sizeLabel = computed<string>(() => {
  if (!props.item) {
    return ''
  }

  return formatKnowledgeBytes(props.item.sizeBytes ?? props.item.textBytes)
})

const statusLabel = computed<string>(() => {
  switch (props.item?.extractStatus) {
    case 'ready':
      return 'Ready'
    case 'no-text':
      return 'No text found'
    default:
      return 'Failed'
  }
})

const extractMessage = computed<string>(() => {
  if (props.item?.extractStatus === 'failed') {
    return describeKnowledgeExtractError(props.item.extractError)
  }

  return 'Besidka found no text in this file.'
})

const normalizedDescription = computed<string>(() => {
  return draftDescription.value.replace(/[\r\n]+/g, ' ').trim()
})

const isDescriptionOverLimit = computed<boolean>(() => {
  return normalizedDescription.value.length
    > KNOWLEDGE_LIMITS.maxDescriptionChars
})

const isPdfSectionVisible = computed<boolean>(() => {
  return !!props.item && isKnowledgePdf(props.item)
})

const isNativePdfToggleVisible = computed<boolean>(() => {
  return props.canSendPdf || !!props.item?.sendAsNativePdf
})

const changes = computed<KnowledgeItemPatchInput>(() => {
  const item = props.item
  const patch: KnowledgeItemPatchInput = {}

  if (!item) {
    return patch
  }

  if (normalizedDescription.value !== (item.description ?? '')) {
    patch.description = normalizedDescription.value || null
  }

  if (
    isPdfSectionVisible.value
    && draftSendAsNativePdf.value !== item.sendAsNativePdf
  ) {
    patch.sendAsNativePdf = draftSendAsNativePdf.value
  }

  return patch
})

const isSaveDisabled = computed<boolean>(() => {
  return isSaving.value
    || isDescriptionOverLimit.value
    || Object.keys(changes.value).length === 0
})

function resetDrafts() {
  draftDescription.value = props.item?.description ?? ''
  draftSendAsNativePdf.value = props.item?.sendAsNativePdf ?? false
  saveError.value = null
}

function emitRemove() {
  if (props.item) {
    emit('remove', props.item)
  }
}

function emitReadd() {
  if (props.item) {
    emit('readd', props.item)
  }
}

async function save() {
  const item = props.item

  if (!item || isSaveDisabled.value) {
    return
  }

  isSaving.value = true
  saveError.value = null

  const outcome = await props.patchItem(item.id, changes.value)

  isSaving.value = false

  if (!outcome.ok) {
    saveError.value = outcome.parsed

    return
  }

  useInfoMessage('Saved', 'Knowledge item updated.')
  open.value = false
}

function onModalClosed() {
  open.value = false
}

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    resetDrafts()
    modal.value.showModal()

    return
  }

  modal.value.close()
}, { immediate: true, flush: 'post' })
</script>
