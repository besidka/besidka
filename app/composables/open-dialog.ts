export function useOpenDialog() {
  const hasOpenDialog = useState<boolean>('ui:has-open-dialog', () => false)
  let observer: MutationObserver | null = null

  function syncOpenDialogState() {
    if (!import.meta.client) {
      return
    }

    hasOpenDialog.value = !!document.querySelector('dialog[open]')
  }

  onMounted(() => {
    syncOpenDialogState()

    observer = new MutationObserver(() => {
      syncOpenDialogState()
    })

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['open'],
      subtree: true,
    })

    document.addEventListener('focusin', syncOpenDialogState)
    document.addEventListener('focusout', syncOpenDialogState)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    document.removeEventListener('focusin', syncOpenDialogState)
    document.removeEventListener('focusout', syncOpenDialogState)
  })

  return {
    hasOpenDialog,
    syncOpenDialogState,
  }
}
