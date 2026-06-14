const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ')

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    return !!(
      element.offsetWidth
      || element.offsetHeight
      || element.getClientRects().length
    )
  })
}

export function trapTabKey(
  event: KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== 'Tab') {
    return
  }

  const focusable = getFocusable(container)

  if (focusable.length === 0) {
    event.preventDefault()

    return
  }

  const firstElement = focusable[0]!
  const lastElement = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement

  if (event.shiftKey) {
    if (active === firstElement || active === container) {
      event.preventDefault()
      lastElement.focus()
    }
  } else {
    if (
      active === lastElement
      || active === container
      || !focusable.includes(active)
    ) {
      event.preventDefault()
      firstElement.focus()
    }
  }
}
