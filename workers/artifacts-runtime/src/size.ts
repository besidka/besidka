type SizeNotifier = (height: number) => void

let notifySize: SizeNotifier | null = null
let observer: ResizeObserver | null = null
let scheduledFrame = 0
let lastReportedHeight = -1

function measureHeight(): number {
  const root = document.documentElement

  if (!root) {
    return 0
  }

  return Math.ceil(root.getBoundingClientRect().height)
}

function reportSize() {
  scheduledFrame = 0

  const height = measureHeight()

  if (height === lastReportedHeight) {
    return
  }

  lastReportedHeight = height
  notifySize?.(height)
}

export function scheduleSizeReport() {
  if (scheduledFrame || !notifySize) {
    return
  }

  scheduledFrame = requestAnimationFrame(reportSize)
}

export function observeDocumentSize() {
  if (!notifySize) {
    return
  }

  observer ??= new ResizeObserver(scheduleSizeReport)
  observer.disconnect()

  if (document.documentElement) {
    observer.observe(document.documentElement)
  }

  if (document.body) {
    observer.observe(document.body)
  }

  scheduleSizeReport()
}

export function startSizeReporting(notifier: SizeNotifier) {
  notifySize = notifier
  observeDocumentSize()
}
