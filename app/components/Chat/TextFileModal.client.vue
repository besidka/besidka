<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="js-text-file-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="titleId"
      aria-modal="true"
      data-testid="text-file-modal"
      @cancel.prevent="requestClose"
      @close="onClose"
    >
      <div
        class="modal-box flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 [--text-file-sheet-bottom-padding:max(calc(1rem+var(--sab,0px)),env(safe-area-inset-bottom))] max-sm:pb-[var(--text-file-sheet-bottom-padding)]"
        :style="sheetBoxStyle"
        data-testid="text-file-modal-box"
      >
        <header class="flex shrink-0 items-center gap-3">
          <Icon
            name="lucide:file-text"
            size="18"
            class="shrink-0 text-base-content/50"
            aria-hidden="true"
          />
          <h2
            :id="titleId"
            class="min-w-0 grow truncate text-base font-semibold"
            :title="name"
            data-testid="text-file-modal-title"
          >
            {{ name }}
          </h2>
          <form
            method="dialog"
            @submit.prevent="requestClose"
          >
            <button
              ref="closeButtonRef"
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="text-file-modal-close"
            >
              <Icon name="lucide:x" size="16" aria-hidden="true" />
            </button>
          </form>
        </header>

        <div
          class="contents"
          :inert="isContentInert"
          data-testid="text-file-modal-content-region"
        >
          <div
            v-if="isLoading"
            class="skeleton skeleton--default h-64 w-full"
            role="status"
            aria-label="Loading file"
            data-testid="text-file-modal-loading"
          />
          <div
            v-else-if="unavailableMessage"
            class="flex flex-col items-center gap-2 rounded-box bg-base-200 p-8 text-center"
            role="alert"
            data-testid="text-file-modal-unavailable"
          >
            <Icon
              name="lucide:file-warning"
              size="32"
              class="text-base-content/40"
            />
            <p class="text-sm text-base-content/70">
              {{ unavailableMessage }}
            </p>
          </div>
          <template v-else>
            <pre
              v-if="isReadonly"
              class="min-h-0 grow overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-3 font-mono text-xs"
              tabindex="0"
              data-testid="text-file-modal-content"
            >{{ draft }}</pre>
            <textarea
              v-else
              ref="textareaRef"
              v-model="draft"
              class="textarea w-full grow resize-none font-mono text-xs"
              :class="isKeyboardCovering ? 'min-h-24' : 'min-h-64'"
              spellcheck="false"
              aria-label="File content"
              data-testid="text-file-modal-textarea"
            />
            <p
              class="shrink-0 text-xs text-base-content/60"
              data-testid="text-file-modal-counter"
            >
              {{ characterCount }} characters, {{ lineCount }} lines
            </p>
          </template>

          <div class="modal-action mt-0 shrink-0 flex-wrap">
            <template v-if="isReadonly">
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="!canUseContent"
                data-testid="text-file-modal-copy"
                @click="copyContent"
              >
                <Icon name="lucide:copy" size="14" aria-hidden="true" />
                Copy
              </button>
              <a
                v-if="url"
                :href="url"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm btn-ghost"
                data-testid="text-file-modal-raw"
              >
                <Icon
                  name="lucide:external-link"
                  size="14"
                  aria-hidden="true"
                />
                Open raw
              </a>
              <a
                v-if="downloadUrl"
                :href="downloadUrl"
                class="btn btn-sm btn-ghost"
                data-testid="text-file-modal-download"
                @click="onDownloadClick($event, {
                  url: downloadUrl,
                  fileName: name,
                })"
              >
                <Icon name="lucide:download" size="14" aria-hidden="true" />
                Download
              </a>
            </template>
            <template v-else>
              <button
                v-if="canInsert"
                type="button"
                class="btn btn-sm btn-ghost mr-auto"
                :disabled="!canUseContent"
                data-testid="text-file-modal-insert"
                @click="emit('insert', draft)"
              >
                <Icon
                  name="lucide:text-cursor-input"
                  size="14"
                  aria-hidden="true"
                />
                Insert as text
              </button>
              <button
                type="button"
                class="btn btn-sm"
                data-testid="text-file-modal-cancel"
                @click="requestClose"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm btn-accent"
                :disabled="!canSave"
                data-testid="text-file-modal-save"
                @click="emit('save', draft)"
              >
                Save
              </button>
            </template>
          </div>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @submit.prevent="requestClose"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import { parseError } from 'evlog'

const SHEET_KEYBOARD_BOTTOM_PADDING = '0.375rem'

const props = withDefaults(defineProps<{
  name: string
  url?: string
  downloadUrl?: string
  size?: number
  content?: string | null
  isReadonly?: boolean
  canInsert?: boolean
}>(), {
  url: undefined,
  downloadUrl: undefined,
  size: undefined,
  content: undefined,
  isReadonly: false,
  canInsert: false,
})

const emit = defineEmits<{
  save: [content: string]
  insert: [content: string]
}>()

const isOpen = defineModel<boolean>('open', { required: true })
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const closeButtonRef = useTemplateRef<HTMLButtonElement>('closeButtonRef')
const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef')
const clipboard = useClipboard()
const { onDownloadClick } = useFileDownload()
const { isDesktop } = useDevice()
const isCenteredLayout = useMediaQuery('(min-width: 40rem)')
const { isKeyboardOpen } = useVisualViewportInset()
const titleId = useId()
const previouslyFocusedElement = shallowRef<HTMLElement | null>(null)
const originalContent = shallowRef<string>('')
const draft = shallowRef<string>('')
const isLoading = shallowRef<boolean>(false)
const unavailableMessage = shallowRef<string>('')
const isConfirmingClose = shallowRef<boolean>(false)
const isContentInert = shallowRef<boolean>(false)

const characterCount = computed<number>(() => draft.value.length)
const lineCount = computed<number>(() => countTextLines(draft.value))
const canUseContent = computed<boolean>(() => {
  return !isLoading.value && !unavailableMessage.value
})
const isKeyboardCovering = computed<boolean>(() => {
  return isOpen.value && isKeyboardOpen.value
})
const shouldFocusTextarea = computed<boolean>(() => {
  return isDesktop && isCenteredLayout.value
})
const hasUnsavedChanges = computed<boolean>(() => {
  return !props.isReadonly
    && canUseContent.value
    && draft.value !== originalContent.value
})
const canSave = computed<boolean>(() => {
  return canUseContent.value
    && draft.value !== originalContent.value
    && draft.value.trim().length > 0
})

/**
 * The global dialog rule in `main.css` lifts the sheet above the on-screen
 * keyboard and caps its height to what stays visible, so only the safe-area
 * padding under the actions is dropped here while the keyboard is up.
 */
const sheetBoxStyle = computed<StyleValue>(() => {
  if (!isKeyboardCovering.value) {
    return {}
  }

  return {
    '--text-file-sheet-bottom-padding': SHEET_KEYBOARD_BOTTOM_PADDING,
  }
})

function applyContent(content: string) {
  originalContent.value = content
  draft.value = content
}

async function loadContent() {
  if (typeof props.content === 'string') {
    applyContent(props.content)

    return
  }

  if (!props.url) {
    unavailableMessage.value = 'This file cannot be loaded.'

    return
  }

  if (props.size && props.size > TEXT_FILE_VIEW_MAX_BYTES) {
    unavailableMessage.value = `This file is larger than ${
      formatFileSize(TEXT_FILE_VIEW_MAX_BYTES)
    }. Open the raw file or download it instead.`

    return
  }

  isLoading.value = true

  try {
    applyContent(await fetchTextFileContent(props.url))
  } catch (exception) {
    const parsedException = parseError(exception)

    unavailableMessage.value = parsedException.message
      || 'The file could not be loaded.'
  } finally {
    isLoading.value = false
  }
}

async function copyContent() {
  await clipboard.copy(draft.value)
  useSuccessMessage('Copied to clipboard')
}

function restoreFocus() {
  previouslyFocusedElement.value?.focus()
  previouslyFocusedElement.value = null
}

/**
 * iOS WebKit ignores `autofocus` when `showModal()` picks the initial focus
 * and takes the first link or text field instead, which opens the keyboard
 * over the editor. The content is therefore inert while the dialog opens (set
 * before the render that precedes this call), the close button takes focus
 * explicitly and the content is released in the same call.
 */
function showDialog(dialog: HTMLDialogElement) {
  try {
    dialog.showModal()
    closeButtonRef.value?.focus({ preventScroll: true })
  } finally {
    isContentInert.value = false
  }
}

async function updateDialog(shouldOpen: boolean) {
  const dialog = dialogRef.value

  if (!dialog) {
    return
  }

  if (!shouldOpen) {
    if (dialog.open) {
      dialog.close()
    }

    return
  }

  if (dialog.open) {
    return
  }

  previouslyFocusedElement.value = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  isContentInert.value = true

  await nextTick()

  const currentDialog = dialogRef.value

  if (!isOpen.value || !currentDialog || currentDialog.open) {
    isContentInert.value = false

    return
  }

  showDialog(currentDialog)
}

async function requestClose() {
  if (isConfirmingClose.value) {
    return
  }

  if (!hasUnsavedChanges.value) {
    isOpen.value = false

    return
  }

  isConfirmingClose.value = true

  try {
    const result = await useConfirm({
      text: 'Discard your unsaved changes?',
      actions: ['Discard'],
      labelDecline: 'Keep editing',
    })

    if (result) {
      isOpen.value = false
    }
  } finally {
    isConfirmingClose.value = false
  }
}

function onClose() {
  isOpen.value = false
  restoreFocus()
}

onMounted(async () => {
  await updateDialog(isOpen.value)
  await loadContent()
  await nextTick()

  if (shouldFocusTextarea.value && !props.isReadonly && canUseContent.value) {
    textareaRef.value?.focus()
  }
})

onBeforeUnmount(() => {
  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }

  restoreFocus()
})

watch(isOpen, updateDialog, { flush: 'post' })
</script>
