export interface ScrollAnchor {
  scroller: HTMLElement
  element: HTMLElement
  offset: number
}

function isScrollable(element: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(element)

  return overflowY === 'auto' || overflowY === 'scroll'
}

function findScrollParent(element: Element | null): HTMLElement | null {
  let current = element?.parentElement ?? null

  while (current) {
    if (isScrollable(current)) {
      return current
    }

    current = current.parentElement
  }

  return null
}

function resolveScroller(): HTMLElement | null {
  const messagesContainer = document.querySelector(
    '.js-chat-messages-container',
  )
  const chatScroller = findScrollParent(messagesContainer)

  if (chatScroller) {
    return chatScroller
  }

  const pageContent = document.querySelector<HTMLElement>('.js-page-content')

  return pageContent && isScrollable(pageContent) ? pageContent : null
}

function getAnchorCandidates(scroller: HTMLElement): HTMLElement[] {
  const messages = Array.from(
    scroller.querySelectorAll<HTMLElement>('[data-message-id]'),
  )

  if (messages.length) {
    return messages
  }

  return Array.from(scroller.children).filter((child) => {
    return child instanceof HTMLElement
  }) as HTMLElement[]
}

/**
 * Remembers the first element visible at the top of the page's scroll
 * container, so a width change that reflows the content (the side panel
 * docking, a seam drag) can put that element back where the reader saw it.
 */
export function captureScrollAnchor(): ScrollAnchor | null {
  if (!import.meta.client) {
    return null
  }

  const scroller = resolveScroller()

  if (!scroller || scroller.scrollTop <= 0) {
    return null
  }

  const scrollerTop = scroller.getBoundingClientRect().top
  const element = getAnchorCandidates(scroller).find((candidate) => {
    return candidate.getBoundingClientRect().bottom > scrollerTop
  })

  if (!element) {
    return null
  }

  return {
    scroller,
    element,
    offset: element.getBoundingClientRect().top - scrollerTop,
  }
}

export function restoreScrollAnchor(anchor: ScrollAnchor | null): void {
  if (!anchor || !anchor.element.isConnected) {
    return
  }

  const scrollerTop = anchor.scroller.getBoundingClientRect().top
  const currentOffset = anchor.element.getBoundingClientRect().top
    - scrollerTop
  const delta = currentOffset - anchor.offset

  if (Math.abs(delta) < 1) {
    return
  }

  anchor.scroller.scrollTop += delta
}

/**
 * Keeps the anchor in place on every frame for `durationMs`, which covers a
 * CSS width transition without a visible jump at its end.
 */
export function holdScrollAnchor(
  anchor: ScrollAnchor | null,
  durationMs: number,
): () => void {
  if (!anchor) {
    return () => {}
  }

  const startedAt = performance.now()
  let frameId = 0

  function step(now: number) {
    restoreScrollAnchor(anchor)

    if (now - startedAt < durationMs) {
      frameId = requestAnimationFrame(step)
    }
  }

  frameId = requestAnimationFrame(step)

  return () => {
    cancelAnimationFrame(frameId)
  }
}
