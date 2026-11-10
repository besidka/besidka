import { whenKitBlocksReady } from './kit/elements.ts'

const FRAME_FALLBACK_MS = 100

const FINAL_PAINT_CAP_MS = 6_000

let isRevealed = true

export function applyVisibility() {
  document.documentElement.style.visibility = isRevealed ? '' : 'hidden'
}

export function hideDocument() {
  isRevealed = false
  applyVisibility()
}

export function revealDocument() {
  isRevealed = true
  applyVisibility()
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, FRAME_FALLBACK_MS)

    requestAnimationFrame(() => {
      clearTimeout(fallback)
      resolve()
    })
  })
}

async function waitForFonts() {
  await nextFrame()
  await document.fonts?.ready
}

/**
 * Resolves when the first render of every kit block and the fonts the page
 * asked for have settled, or after the cap, so a slow block reveals late
 * instead of blocking the artifact. The document stays hidden (not removed
 * from layout) until then, so a diagram never shows as its source text.
 */
export async function waitForFinalPaint() {
  let capTimer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<void>((resolve) => {
    capTimer = setTimeout(resolve, FINAL_PAINT_CAP_MS)
  })

  await Promise.race([
    Promise.all([whenKitBlocksReady(), waitForFonts()]),
    cap,
  ])
  clearTimeout(capTimer)
}
