import { LazyChatDocumentPreview } from '#components'
import { getDocumentFormatFromMediaType } from '#shared/utils/documents'
import type { DocumentFormat } from '#shared/utils/documents'

export interface DocumentPreviewTarget {
  documentId: string
  format: DocumentFormat
  title: string
  storageKey?: string
}

export function getDocumentPreviewViewKey(documentId: string): string {
  return `document:${documentId}`
}

/**
 * Opens a document in the global side panel: the same `DocumentPreview` the
 * in-chat card opens. With a `storageKey` the file links are known up front,
 * without one the preview reads them from the document status route.
 */
export function useDocumentPreview() {
  const sidePanel = useSidePanel()
  const documentsFeature = useFeature('documents')

  function canPreviewFile(file: {
    documentId?: string | null
    type: string
  }): boolean {
    return documentsFeature.value.active
      && !!file.documentId
      && getDocumentFormatFromMediaType(file.type) !== null
  }

  function isShowing(documentId: string): boolean {
    return sidePanel.isOpen.value
      && sidePanel.viewKey.value === getDocumentPreviewViewKey(documentId)
  }

  function open(target: DocumentPreviewTarget): void {
    sidePanel.open({
      viewKey: getDocumentPreviewViewKey(target.documentId),
      title: target.title,
      mode: 'detail',
      component: LazyChatDocumentPreview,
      props: {
        documentId: target.documentId,
        format: target.format,
        title: target.title,
        ...(target.storageKey
          ? {
            viewUrl: getFileUrl(target.storageKey),
            downloadUrl: getFileDownloadUrl(target.storageKey),
          }
          : {}),
      },
    })
  }

  function closeIfShowing(documentId: string): void {
    if (isShowing(documentId)) {
      sidePanel.close()
    }
  }

  return { open, isShowing, closeIfShowing, canPreviewFile }
}
