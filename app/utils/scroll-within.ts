const LEADING_GAP_PX = 28
const TRAILING_GAP_PX = 8

interface ScrollWithinOptions {
  trailingElement?: Element | null
  reservedBottomPx?: number
}

/**
 * Brings `target` (and the optional `trailingElement`, such as its error
 * text) into view by scrolling `container` only. Never calls
 * `scrollIntoView`, which also scrolls the window and the visual viewport on
 * iOS and shifts a dialog that sits above the keyboard.
 */
export function scrollWithin(
  container: HTMLElement,
  target: Element,
  options: ScrollWithinOptions = {},
) {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const trailingRect = options.trailingElement?.getBoundingClientRect()
  const regionTop = targetRect.top - LEADING_GAP_PX
  const regionBottom = Math.max(
    targetRect.bottom,
    trailingRect?.bottom ?? targetRect.bottom,
  ) + TRAILING_GAP_PX
  const visibleTop = containerRect.top
  const visibleBottom = containerRect.bottom - (options.reservedBottomPx ?? 0)
  const fitsInView = regionBottom - regionTop <= visibleBottom - visibleTop

  if (regionTop < visibleTop || !fitsInView) {
    container.scrollTop += regionTop - visibleTop

    return
  }

  if (regionBottom > visibleBottom) {
    container.scrollTop += regionBottom - visibleBottom
  }
}
