/**
 * Tracks the newest open modal `<dialog>`. A modal dialog lives in the top
 * layer above every z-index and makes everything outside its own subtree
 * inert, so anything that must stay visible and clickable over it, such as
 * the message toasts, has to be rendered inside it.
 */
export function useTopModalDialog() {
  const topDialog = shallowRef<HTMLDialogElement | null>(null)
  let openDialogs: HTMLDialogElement[] = []
  let observer: MutationObserver | null = null

  function isOpenModal(dialog: HTMLDialogElement): boolean {
    try {
      return dialog.isConnected && dialog.open && dialog.matches(':modal')
    } catch {
      return false
    }
  }

  function sync(dialog: HTMLDialogElement) {
    const isOpen = isOpenModal(dialog)

    openDialogs = openDialogs.filter((openDialog) => {
      return openDialog !== dialog && isOpenModal(openDialog)
    })

    if (isOpen) {
      openDialogs.push(dialog)
    }

    topDialog.value = openDialogs.at(-1) ?? null
  }

  onMounted(() => {
    document.querySelectorAll('dialog[open]').forEach((element) => {
      sync(element as HTMLDialogElement)
    })

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof HTMLDialogElement) {
          sync(record.target)
        }
      }
    })
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return topDialog
}
