export interface FileDownloadTarget {
  url: string
  fileName: string
}

export type BlobBuilder = () => Blob | Promise<Blob>

export interface BlobDownloadTarget {
  key: string
  fileName: string
  build: BlobBuilder
}

type ShareDownloadOutcome
  = | 'saved'
    | 'cancelled'
    | 'awaiting-tap'
    | 'unsupported'
    | 'failed'
    | 'busy'

interface PendingFile {
  file: File
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const ANCHOR_REVOKE_DELAY_MS = 4000
const PENDING_FILE_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 30_000
const pendingFiles = new Map<string, PendingFile>()
const isSharing = shallowRef<boolean>(false)
let isVisibilityClearBound = false

function bindVisibilityClear(): void {
  if (isVisibilityClearBound || typeof document === 'undefined') {
    return
  }

  isVisibilityClearBound = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearPendingFiles()
    }
  })
}

function forgetPendingFile(key: string): void {
  const pending = pendingFiles.get(key)

  if (!pending) {
    return
  }

  clearTimeout(pending.timer)
  pendingFiles.delete(key)
}

function clearPendingFiles(): void {
  for (const key of [...pendingFiles.keys()]) {
    forgetPendingFile(key)
  }
}

function takePendingFile(key: string): File | null {
  const pending = pendingFiles.get(key)

  if (!pending) {
    return null
  }

  if (pending.expiresAt < Date.now()) {
    forgetPendingFile(key)

    return null
  }

  return pending.file
}

function keepPendingFile(key: string, file: File): void {
  forgetPendingFile(key)
  pendingFiles.set(key, {
    file,
    expiresAt: Date.now() + PENDING_FILE_TTL_MS,
    timer: setTimeout(() => {
      pendingFiles.delete(key)
    }, PENDING_FILE_TTL_MS),
  })
}

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
  if (!target.url) {
    throw new Error('There is no file to download')
  }

  const response = await fetch(target.url, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

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
 * One entry point for every download button. Everywhere except the iOS
 * home-screen app the browser keeps its native download, so desktop, Android
 * and Safari tabs are untouched. In the iOS home-screen app a download
 * replaces the only web view with a full-screen file view that has no way
 * back, so the file goes to the native share sheet ("Save to Files") instead.
 */
export function useFileDownload() {
  bindVisibilityClear()

  function isStandaloneIos(): boolean {
    return isIosDevice(navigator.userAgent) && isStandaloneDisplay()
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
  ): Promise<ShareDownloadOutcome> {
    if (isSharing.value) {
      useInfoMessage('Still preparing the previous file')

      return 'busy'
    }

    isSharing.value = true

    try {
      const cachedFile = takePendingFile(key)
      const file = cachedFile ?? await resolveFile()
      const outcome = await shareFile(file)

      if (outcome === 'needs-gesture' && cachedFile) {
        forgetPendingFile(key)
        useErrorMessage(
          'Failed to save the file',
          'The share sheet could not be opened. Try downloading it again.',
        )

        return 'failed'
      }

      if (outcome === 'needs-gesture') {
        keepPendingFile(key, file)
        useInfoMessage(
          `${file.name} is ready`,
          'Tap download once more to save it.',
        )

        return 'awaiting-tap'
      }

      forgetPendingFile(key)

      return outcome === 'shared' ? 'saved' : outcome
    } catch (exception) {
      forgetPendingFile(key)
      useErrorMessage(
        'Failed to download the file',
        exception instanceof Error ? exception.message : undefined,
      )

      return 'failed'
    } finally {
      isSharing.value = false
    }
  }

  async function onDownloadClick(
    event: MouseEvent,
    target: FileDownloadTarget,
  ): Promise<void> {
    if (!isStandaloneIos()) {
      return
    }

    event.preventDefault()

    if (!canUseShareSheet()) {
      reportUnsupported()

      return
    }

    const outcome = await shareDownloadedFile(target.url, () => {
      return fetchShareFile(target)
    })

    if (outcome === 'unsupported') {
      reportUnsupported()
    }
  }

  /**
   * Resolves to false when nothing was saved because of a failure. The Blob
   * is built lazily and only after a kept file for the same `key` is looked
   * up, so the second tap after an expired gesture shares synchronously.
   */
  async function downloadBlob(target: BlobDownloadTarget): Promise<boolean> {
    if (!isStandaloneIos()) {
      const built = target.build()
      const blob = built instanceof Blob ? built : await built

      triggerAnchorDownload(URL.createObjectURL(blob), target.fileName, {
        revokeAfterClick: true,
      })

      return true
    }

    if (!canUseShareSheet()) {
      reportUnsupported()

      return false
    }

    const outcome = await shareDownloadedFile(target.key, async () => {
      return createShareFile(await target.build(), target.fileName)
    })

    if (outcome === 'unsupported') {
      reportUnsupported()
    }

    return outcome === 'saved'
      || outcome === 'cancelled'
      || outcome === 'awaiting-tap'
  }

  return { onDownloadClick, downloadBlob }
}
