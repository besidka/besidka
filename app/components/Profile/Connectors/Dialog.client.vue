<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal modal-bottom sm:modal-middle"
      :class="hookClass"
      :aria-labelledby="titleId"
      aria-modal="true"
      :data-testid="testId"
      @cancel.prevent="requestClose"
      @close="onClose"
    >
      <div
        class="modal-box flex max-h-[90dvh] w-full flex-col gap-0 p-0"
        :class="size === 'lg' ? 'max-w-3xl' : 'max-w-lg'"
      >
        <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-4 py-3 pt-[max(0.75rem,var(--sat))] sm:pt-3">
          <h2
            :id="titleId"
            class="min-w-0 grow truncate text-base font-semibold"
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
              :disabled="isBusy"
              :data-testid="`${testId}-close`"
            >
              <Icon name="lucide:x" size="16" aria-hidden="true" />
            </button>
          </form>
        </header>
        <div
          class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          :inert="isContentInert"
        >
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-base-300 px-4 py-3 pb-[max(0.75rem,var(--sab))] [html[data-keyboard-open]_&]:pb-3"
          :inert="isContentInert"
        >
          <slot name="footer" />
        </footer>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @submit.prevent="requestClose"
      >
        <button :disabled="isBusy">
          Close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  hookClass?: string
  testId?: string
  isBusy?: boolean
  size?: 'md' | 'lg'
}>(), {
  size: 'md',
  hookClass: '',
  testId: 'connector-dialog',
  isBusy: false,
})

const emit = defineEmits<{
  close: []
}>()

const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const closeButtonRef = useTemplateRef<HTMLButtonElement>('closeButtonRef')
const titleId = useId()
const previouslyFocusedElement = shallowRef<HTMLElement | null>(null)
const isContentInert = shallowRef<boolean>(true)

function restoreFocus() {
  previouslyFocusedElement.value?.focus()
  previouslyFocusedElement.value = null
}

function requestClose() {
  if (props.isBusy) {
    return
  }

  if (dialogRef.value?.open) {
    dialogRef.value.close()

    return
  }

  emit('close')
}

function onClose() {
  emit('close')
  restoreFocus()
}

/**
 * iOS WebKit ignores `autofocus` when `showModal()` picks the first focus
 * and focuses the first text field, which opens the keyboard over the
 * dialog. The body stays inert until the close button has taken focus.
 */
function openDialog() {
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
}

defineExpose({ requestClose })

onMounted(openDialog)

onBeforeUnmount(() => {
  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }

  restoreFocus()
})
</script>
