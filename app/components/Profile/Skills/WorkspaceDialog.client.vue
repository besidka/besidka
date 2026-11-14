<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal modal-bottom sm:modal-middle"
      :class="hookClass"
      :aria-labelledby="titleId"
      aria-modal="true"
      data-testid="skills-dialog"
      @cancel.prevent="requestClose"
      @close="onClose"
    >
      <div
        class="modal-box flex w-full flex-col gap-0 p-0"
        :class="size === 'workspace' ? WORKSPACE_BOX_CLASS : FORM_BOX_CLASS"
        data-testid="skills-dialog-box"
      >
        <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-4 py-3 pt-[max(0.75rem,var(--sat))] sm:pt-3">
          <h2
            :id="titleId"
            class="min-w-0 grow truncate text-base font-semibold"
            data-testid="skills-dialog-title"
          >
            {{ title }}
          </h2>
          <form
            method="dialog"
            @submit.prevent="requestClose"
          >
            <button
              ref="closeButtonRef"
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="skills-dialog-close"
            >
              <Icon name="lucide:x" size="16" aria-hidden="true" />
            </button>
          </form>
        </header>
        <div
          class="min-h-0 flex-1"
          :class="isEditMode
            ? 'flex flex-col overflow-hidden'
            : 'overflow-y-auto px-4 py-4'"
          :inert="isContentInert"
          data-testid="skills-dialog-body"
        >
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-base-300 px-4 py-3 pb-[max(0.75rem,var(--sab))] [html[data-keyboard-open]_&]:pb-3"
          :inert="isContentInert"
          data-testid="skills-dialog-footer"
        >
          <slot name="footer" />
        </footer>
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
const WORKSPACE_BOX_CLASS = [
  'max-w-5xl sm:h-[85vh]',
  'max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none',
].join(' ')
const FORM_BOX_CLASS = 'max-w-lg max-h-[90dvh]'

const props = withDefaults(defineProps<{
  title: string
  size?: 'form' | 'workspace'
  mode?: 'view' | 'edit'
  hookClass?: string
  isBusy?: boolean
  isDirty?: boolean
}>(), {
  size: 'form',
  mode: 'view',
  hookClass: '',
  isBusy: false,
  isDirty: false,
})

const emit = defineEmits<{
  close: []
}>()

const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const closeButtonRef = useTemplateRef<HTMLButtonElement>('closeButtonRef')
const titleId = useId()
const previouslyFocusedElement = shallowRef<HTMLElement | null>(null)
const isContentInert = shallowRef<boolean>(true)
const isConfirmingClose = shallowRef<boolean>(false)

const isEditMode = computed<boolean>(() => {
  return props.mode === 'edit'
})

function restoreFocus() {
  previouslyFocusedElement.value?.focus()
  previouslyFocusedElement.value = null
}

function closeDialog() {
  if (dialogRef.value?.open) {
    dialogRef.value.close()

    return
  }

  emit('close')
}

/**
 * Every way out of an editing dialog (Escape, the close button, the
 * backdrop, Cancel) comes through here, so unsaved changes are always
 * confirmed, the way `TextFileModal` does it.
 */
async function requestClose() {
  if (props.isBusy || isConfirmingClose.value) {
    return
  }

  if (!isEditMode.value || !props.isDirty) {
    closeDialog()

    return
  }

  isConfirmingClose.value = true

  try {
    const isDiscarded = await useConfirm({
      text: 'Discard your unsaved changes?',
      actions: ['Discard'],
      labelDecline: 'Keep editing',
    })

    if (isDiscarded) {
      closeDialog()
    }
  } finally {
    isConfirmingClose.value = false
  }
}

function onClose() {
  emit('close')
  restoreFocus()
}

/**
 * iOS WebKit ignores `autofocus` when `showModal()` picks the initial focus
 * and takes the first text field instead, which opens the keyboard over the
 * dialog. The body is inert until the close button has taken focus.
 */
async function openDialog() {
  const dialog = dialogRef.value

  if (!dialog || dialog.open) {
    return
  }

  previouslyFocusedElement.value = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null

  try {
    dialog.showModal()
    closeButtonRef.value?.focus({ preventScroll: true })
  } finally {
    isContentInert.value = false
  }

  await nextTick()
}

defineExpose({ requestClose, forceClose: closeDialog })

onMounted(openDialog)

onBeforeUnmount(() => {
  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }

  restoreFocus()
})
</script>
