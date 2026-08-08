import type { FileSourceFilter } from '~/types/file-manager'

interface PendingFilesModalOpen {
  tab: 'select' | 'upload'
  source?: FileSourceFilter
  targetPath: string
}

export function useFilesModalHandoff() {
  const pendingOpen = useState<PendingFilesModalOpen | null>(
    'files-modal-handoff:pending-open',
    () => null,
  )

  function requestOpen(
    tab: 'select' | 'upload',
    targetPath: string,
    source?: FileSourceFilter,
  ) {
    pendingOpen.value = { tab, source, targetPath }
  }

  function clearPendingOpen() {
    pendingOpen.value = null
  }

  return {
    pendingOpen,
    requestOpen,
    clearPendingOpen,
  }
}
