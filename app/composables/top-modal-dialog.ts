/**
 * Tracks the newest open modal `<dialog>`. A modal dialog lives in the top
 * layer above every z-index and makes everything outside its own subtree
 * inert, so anything that must stay visible and clickable over it, such as
 * the message toasts, has to be rendered inside it.
 *
 * A dialog that Vue unmounts without calling `close()` keeps its `open`
 * attribute and fires no attribute mutation, so removals are watched too.
 * That check only runs while a dialog is tracked and only compares
 * `isConnected` of those few nodes, so streamed chat tokens cost nothing
 * when no dialog is open. `refresh()` does the same check on demand.
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

  function refresh() {
    if (!openDialogs.some(dialog => !isOpenModal(dialog))) {
      return
    }

    openDialogs = openDialogs.filter(isOpenModal)
    topDialog.value = openDialogs.at(-1) ?? null
  }

  onMounted(() => {
    document.querySelectorAll('dialog[open]').forEach((element) => {
      sync(element as HTMLDialogElement)
    })

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes'
          && record.target instanceof HTMLDialogElement
        ) {
          sync(record.target)
        }
      }

      if (openDialogs.length) {
        refresh()
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return { topDialog, refresh }
}
