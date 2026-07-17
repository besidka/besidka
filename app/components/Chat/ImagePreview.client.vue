<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal p-0"
      :aria-labelledby="titleId"
      aria-modal="true"
      data-testid="image-preview-modal"
      @close="onClose"
    >
      <div
        class="modal-box flex h-dvh max-h-none w-screen max-w-none flex-col rounded-none p-3 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-box sm:p-4"
      >
        <header class="mb-3 flex shrink-0 items-center gap-3">
          <h2
            :id="titleId"
            class="min-w-0 grow truncate text-sm font-medium sm:text-base"
            :title="filename"
          >
            {{ filename }}
          </h2>
          <a
            :href="downloadUrl"
            class="btn btn-sm btn-accent"
            :aria-label="`Download ${filename}`"
            data-testid="image-preview-download"
          >
            <Icon name="lucide:download" size="15" aria-hidden="true" />
            <span class="max-xs:sr-only">Download</span>
          </a>
          <form method="dialog">
            <button
              ref="closeButtonRef"
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close image preview"
              data-testid="image-preview-close"
            >
              <Icon name="lucide:x" size="18" aria-hidden="true" />
            </button>
          </form>
        </header>

        <div
          class="flex min-h-0 grow items-center justify-center overflow-hidden rounded-box bg-base-200"
        >
          <img
            v-if="isDialogVisible"
            :src="src"
            :alt="alt"
            class="max-h-full max-w-full object-contain"
            data-testid="image-preview-image"
          >
        </div>
      </div>

      <form method="dialog" class="modal-backdrop">
        <button aria-label="Close image preview">Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  src: string
  downloadUrl: string
  alt: string
  filename: string
}>()

const isOpen = defineModel<boolean>('open', { required: true })
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const closeButtonRef = useTemplateRef<HTMLButtonElement>('closeButtonRef')
const titleId = useId()
const previouslyFocusedElement = shallowRef<HTMLElement | null>(null)
const isDialogVisible = shallowRef<boolean>(false)

function restoreFocus() {
  previouslyFocusedElement.value?.focus()
  previouslyFocusedElement.value = null
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

    isDialogVisible.value = false

    return
  }

  if (dialog.open) {
    isDialogVisible.value = true

    return
  }

  previouslyFocusedElement.value = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  dialog.showModal()
  isDialogVisible.value = true

  await nextTick()

  if (isOpen.value) {
    closeButtonRef.value?.focus()
  }
}

function onClose() {
  isDialogVisible.value = false
  isOpen.value = false
  restoreFocus()
}

onBeforeUnmount(() => {
  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }

  isDialogVisible.value = false
  restoreFocus()
})

onMounted(async () => {
  await updateDialog(isOpen.value)
})

watch(isOpen, updateDialog, {
  flush: 'post',
})
</script>
