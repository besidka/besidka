<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-knowledge-note-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="knowledge-note-modal"
      @close="onModalClosed"
    >
      <div class="modal-box flex max-h-[90dvh] max-w-2xl flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
            data-testid="knowledge-note-heading"
          >
            {{ isEditing ? 'Edit note' : 'New note' }}
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="knowledge-note-close"
            >
              <Icon
                name="lucide:x"
                size="16"
              />
            </button>
          </form>
        </div>
        <div class="-me-2 min-h-0 flex-1 overflow-y-auto pe-2">
          <div
            v-if="isLoadingText"
            class="grid gap-2"
            data-testid="knowledge-note-loading"
          >
            <div class="skeleton skeleton--default h-10 w-full" />
            <div class="skeleton skeleton--default h-48 w-full" />
          </div>
          <div
            v-else-if="loadError"
            role="alert"
            class="alert alert-soft alert-error !items-start"
            data-testid="knowledge-note-load-error"
          >
            <Icon
              name="lucide:circle-alert"
              size="20"
              class="mt-0.5 shrink-0"
            />
            <div class="grid min-w-0 gap-1">
              <p class="break-words font-bold">{{ loadError.message }}</p>
              <p
                v-if="loadError.why"
                class="break-words text-sm"
              >
                {{ loadError.why }}
              </p>
            </div>
          </div>
          <div
            v-else
            class="grid gap-4"
          >
            <div
              v-if="isRepairNeeded"
              role="status"
              class="alert alert-soft alert-error !items-start"
              data-testid="knowledge-note-repair"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="break-words">{{ repairMessage }}</p>
                <p class="text-sm">
                  Check the text below and save the note to repair it.
                </p>
              </div>
            </div>
            <div class="grid gap-1">
              <label
                class="text-sm font-semibold"
                :for="titleInputId"
              >
                Title
              </label>
              <input
                :id="titleInputId"
                v-model="draftTitle"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isTitleOverLimit }"
                :aria-invalid="isTitleOverLimit"
                :disabled="isSaving"
                placeholder="What is this note about"
                data-testid="knowledge-note-title"
                @input="saveError = null"
              >
              <p
                class="text-xs"
                :class="isTitleOverLimit
                  ? 'text-error'
                  : 'text-base-content/70'"
                data-testid="knowledge-note-title-counter"
              >
                {{ titleLength }}
                / {{ KNOWLEDGE_LIMITS.maxTitleChars }}
              </p>
            </div>
            <div class="grid gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label
                  class="text-sm font-semibold"
                  :for="bodyInputId"
                >
                  Note (Markdown)
                </label>
                <div
                  role="tablist"
                  aria-label="Note view"
                  class="tabs tabs-box tabs-sm"
                  @keydown.right.prevent="selectTab('preview')"
                  @keydown.left.prevent="selectTab('write')"
                >
                  <button
                    :id="writeTabId"
                    type="button"
                    role="tab"
                    class="tab"
                    :class="{ 'tab-active': activeTab === 'write' }"
                    :aria-selected="activeTab === 'write'"
                    :aria-controls="writePanelId"
                    :tabindex="activeTab === 'write' ? 0 : -1"
                    data-testid="knowledge-note-tab-write"
                    @click="selectTab('write')"
                  >
                    Write
                  </button>
                  <button
                    :id="previewTabId"
                    type="button"
                    role="tab"
                    class="tab"
                    :class="{ 'tab-active': activeTab === 'preview' }"
                    :aria-selected="activeTab === 'preview'"
                    :aria-controls="previewPanelId"
                    :tabindex="activeTab === 'preview' ? 0 : -1"
                    data-testid="knowledge-note-tab-preview"
                    @click="selectTab('preview')"
                  >
                    Preview
                  </button>
                </div>
              </div>
              <div
                v-show="activeTab === 'write'"
                :id="writePanelId"
                role="tabpanel"
                :aria-labelledby="writeTabId"
              >
                <textarea
                  :id="bodyInputId"
                  ref="textarea"
                  v-model="draftBody"
                  class="
                    textarea textarea-bordered rounded-box w-full resize-none
                    overflow-y-auto min-h-48 max-h-[60dvh]
                  "
                  :class="{ 'textarea-error': isBodyOverLimit }"
                  :aria-invalid="isBodyOverLimit"
                  :aria-describedby="bodyCounterId"
                  :disabled="isSaving"
                  placeholder="Write what Besidka should know. Markdown works."
                  data-testid="knowledge-note-body"
                  @input="saveError = null"
                />
              </div>
              <div
                v-if="activeTab === 'preview'"
                :id="previewPanelId"
                role="tabpanel"
                :aria-labelledby="previewTabId"
                class="
                  rounded-box max-h-[60dvh] min-h-48 overflow-y-auto
                  break-words border border-base-content/15 p-3
                "
                data-testid="knowledge-note-preview"
              >
                <MDCCached
                  v-if="draftBody.trim()"
                  :value="draftBody"
                  :cache-key="previewCacheKey"
                  :components="messageComponents"
                  :parser-options="{ highlight: false }"
                  class="chat-markdown text-sm"
                />
                <p
                  v-else
                  class="text-sm text-base-content/60"
                  data-testid="knowledge-note-preview-empty"
                >
                  Nothing to preview yet.
                </p>
              </div>
              <p
                :id="bodyCounterId"
                class="text-xs"
                :class="isBodyOverLimit
                  ? 'text-error'
                  : 'text-base-content/70'"
                data-testid="knowledge-note-body-counter"
              >
                {{ draftBody.length.toLocaleString() }}
                / {{ KNOWLEDGE_LIMITS.maxNoteChars.toLocaleString() }}
                characters
              </p>
            </div>
            <div
              v-if="saveError"
              role="alert"
              class="alert alert-soft alert-error !items-start"
              data-testid="knowledge-note-error"
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
        <div class="mt-4 flex shrink-0 justify-end gap-2">
          <UiButton
            mode="neutral"
            ghost
            size="sm"
            text="Cancel"
            normal-case
            :disabled="isSaving"
            data-testid="knowledge-note-cancel"
            @click="open = false"
          />
          <UiButton
            size="sm"
            normal-case
            :text="isSaving ? 'Saving...' : 'Save note'"
            :disabled="isSaveDisabled"
            data-testid="knowledge-note-save"
            @click="save"
          />
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
import type {
  KnowledgeItemTextResult,
  KnowledgeNoteCreateInput,
  KnowledgeNoteUpdateInput,
  ProjectKnowledgeError,
  ProjectKnowledgeOutcome,
} from '~/types/project-knowledge.d'

type NoteTab = 'write' | 'preview'

const props = defineProps<{
  item: KnowledgeItem | null
  createNote: (
    input: KnowledgeNoteCreateInput,
  ) => Promise<ProjectKnowledgeOutcome<unknown>>
  updateNote: (
    id: string,
    input: KnowledgeNoteUpdateInput,
  ) => Promise<ProjectKnowledgeOutcome<unknown>>
  getItemText: (
    id: string,
  ) => Promise<ProjectKnowledgeOutcome<KnowledgeItemTextResult>>
}>()

const open = defineModel<boolean>('open', { default: false })

const headingId = useId()
const titleInputId = useId()
const bodyInputId = useId()
const bodyCounterId = useId()
const writeTabId = useId()
const previewTabId = useId()
const writePanelId = useId()
const previewPanelId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const { messageComponents } = useChatFormat()

const draftTitle = shallowRef<string>('')
const draftBody = shallowRef<string>('')
const { textarea } = useTextareaAutosize({ input: draftBody })
const originalBody = shallowRef<string>('')
const activeTab = shallowRef<NoteTab>('write')
const isLoadingText = shallowRef<boolean>(false)
const isSaving = shallowRef<boolean>(false)
const loadError = shallowRef<ProjectKnowledgeError | null>(null)
const saveError = shallowRef<ProjectKnowledgeError | null>(null)

let loadToken = 0

const isEditing = computed<boolean>(() => {
  return props.item !== null
})

const normalizedTitle = computed<string>(() => {
  return normalizeKnowledgeTitle(draftTitle.value)
})

const titleLength = computed<number>(() => {
  return draftTitle.value.replace(/[\r\n]+/g, ' ').trim().length
})

const isTitleOverLimit = computed<boolean>(() => {
  return titleLength.value > KNOWLEDGE_LIMITS.maxTitleChars
})

const isBodyOverLimit = computed<boolean>(() => {
  return draftBody.value.length > KNOWLEDGE_LIMITS.maxNoteChars
})

const isRepairNeeded = computed<boolean>(() => {
  return props.item?.extractStatus === 'failed'
})

const repairMessage = computed<string>(() => {
  return describeKnowledgeExtractError(props.item?.extractError ?? null)
})

const hasChanges = computed<boolean>(() => {
  if (!props.item) {
    return true
  }

  return isRepairNeeded.value
    || normalizedTitle.value !== props.item.title
    || draftBody.value !== originalBody.value
})

const isSaveDisabled = computed<boolean>(() => {
  return isSaving.value
    || isLoadingText.value
    || !!loadError.value
    || !normalizedTitle.value
    || !draftBody.value.trim()
    || isTitleOverLimit.value
    || isBodyOverLimit.value
    || !hasChanges.value
})

const previewCacheKey = computed<string>(() => {
  return [
    'knowledge-note-preview',
    props.item?.id ?? 'new',
    draftBody.value.length,
    hashText(draftBody.value),
  ].join(':')
})

function hashText(text: string): number {
  let hash = 5381

  for (let index = 0; index < text.length; index++) {
    hash = (hash * 33 + text.charCodeAt(index)) | 0
  }

  return hash >>> 0
}

function selectTab(tab: NoteTab) {
  activeTab.value = tab
}

function resetDrafts() {
  draftTitle.value = props.item?.title ?? ''
  draftBody.value = ''
  originalBody.value = ''
  activeTab.value = 'write'
  loadError.value = null
  saveError.value = null
  isLoadingText.value = false
}

async function loadNoteText(item: KnowledgeItem) {
  loadToken += 1

  const token = loadToken

  isLoadingText.value = true

  const outcome = await props.getItemText(item.id)

  if (token !== loadToken) {
    return
  }

  isLoadingText.value = false

  if (!outcome.ok) {
    loadError.value = outcome.parsed

    return
  }

  draftBody.value = outcome.result.text
  originalBody.value = outcome.result.text
}

async function save() {
  if (isSaveDisabled.value) {
    return
  }

  isSaving.value = true
  saveError.value = null

  const item = props.item
  const outcome = item
    ? await props.updateNote(item.id, {
      ...(normalizedTitle.value !== item.title
        ? { title: normalizedTitle.value }
        : {}),
      ...(isRepairNeeded.value || draftBody.value !== originalBody.value
        ? { body: draftBody.value }
        : {}),
    })
    : await props.createNote({
      title: normalizedTitle.value,
      body: draftBody.value,
    })

  isSaving.value = false

  if (!outcome.ok) {
    saveError.value = outcome.parsed

    return
  }

  useInfoMessage('Saved', item ? 'Note updated.' : 'Note added.')
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

    if (props.item) {
      loadNoteText(props.item)
    }

    return
  }

  loadToken += 1
  modal.value.close()
}, { immediate: true, flush: 'post' })
</script>
