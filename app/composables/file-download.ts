export interface FileDownloadTarget {
  url: string
  fileName: string
}

const ANCHOR_REVOKE_DELAY_MS = 4000
const pendingFiles = new Map<string, File>()
const isSharing = shallowRef<boolean>(false)

function triggerAnchorDownload(
  href: string,
  fileName: string,
  options: { revokeAfterClick: boolean },
): void {
  const anchor = document.createElement('a')

  anchor.href = href
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  if (!options.revokeAfterClick) {
    return
  }

  setTimeout(() => {
    URL.revokeObjectURL(href)
  }, ANCHOR_REVOKE_DELAY_MS)
}

async function fetchShareFile(target: FileDownloadTarget): Promise<File> {
  const response = await fetch(target.url, { credentials: 'same-origin' })

  if (!response.ok) {
    throw new Error(`The file could not be loaded (${response.status})`)
  }

  return createShareFile(
    await response.blob(),
    target.fileName,
    readContentDispositionFileName(
      response.headers.get('content-disposition'),
    ),
  )
}

/**
 * One entry point for every download button. Off iOS the browser keeps its
 * native download, so desktop and Android are untouched. On iOS the file is
 * handed to the native share sheet ("Save to Files") instead of being
 * navigated to: in a home-screen PWA a download replaces the only web view
 * with a full-screen file view that has no way back.
 */
export function useFileDownload() {
  function isShareSheetAvailable(): boolean {
    return isIosDevice(navigator.userAgent) && canUseShareSheet()
  }

  function reportUnsupported(): void {
    useErrorMessage(
      'This file cannot be saved from the app',
      'Open Besidka in Safari to download it.',
    )
  }

  async function shareDownloadedFile(
    key: string,
    resolveFile: () => Promise<File>,
  ): Promise<boolean> {
    if (isSharing.value) {
      return true
    }

    isSharing.value = true

    try {
      const cachedFile = pendingFiles.get(key) ?? null
      const file = cachedFile ?? await resolveFile()
      const outcome = await shareFile(file)

      if (outcome === 'needs-gesture' && cachedFile) {
        pendingFiles.delete(key)
        useErrorMessage(
          'Failed to save the file',
          'The share sheet could not be opened. Try downloading it again.',
        )

        return true
      }

      if (outcome === 'needs-gesture') {
        pendingFiles.set(key, file)
        useInfoMessage(
          `${file.name} is ready`,
          'Tap download once more to save it.',
        )

        return true
      }

      pendingFiles.delete(key)

      if (outcome === 'unsupported') {
        return false
      }

      return true
    } catch (exception) {
      pendingFiles.delete(key)
      useErrorMessage(
        'Failed to download the file',
        exception instanceof Error ? exception.message : undefined,
      )

      return true
    } finally {
      isSharing.value = false
    }
  }

  async function onDownloadClick(
    event: MouseEvent,
    target: FileDownloadTarget,
  ): Promise<void> {
    if (!isIosDevice(navigator.userAgent)) {
      return
    }

    if (!isShareSheetAvailable()) {
      if (isStandaloneDisplay()) {
        event.preventDefault()
        reportUnsupported()
      }

      return
    }

    event.preventDefault()

    const isHandled = await shareDownloadedFile(target.url, () => {
      return fetchShareFile(target)
    })

    if (isHandled) {
      return
    }

    if (isStandaloneDisplay()) {
      reportUnsupported()

      return
    }

    triggerAnchorDownload(target.url, target.fileName, {
      revokeAfterClick: false,
    })
  }

  async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
    if (!isIosDevice(navigator.userAgent)) {
      triggerAnchorDownload(URL.createObjectURL(blob), fileName, {
        revokeAfterClick: true,
      })

      return
    }

    const isHandled = isShareSheetAvailable()
      && await shareDownloadedFile(`blob:${fileName}:${blob.size}`, () => {
        return Promise.resolve(createShareFile(blob, fileName))
      })

    if (isHandled) {
      return
    }

    if (isStandaloneDisplay()) {
      reportUnsupported()

      return
    }

    triggerAnchorDownload(URL.createObjectURL(blob), fileName, {
      revokeAfterClick: true,
    })
  }

  return { onDownloadClick, downloadBlob }
}
