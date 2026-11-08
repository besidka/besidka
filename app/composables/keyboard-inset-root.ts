/**
 * Mirrors the shared on-screen keyboard measurement onto `<html>` so one
 * global rule in `main.css` keeps every open modal dialog above the keyboard:
 * `--keyboard-inset` (always set, `0px` when closed), and, only while the
 * keyboard is open, `--visible-height` and the `data-keyboard-open` attribute.
 * Called once from `app/app.vue`. See docs/chats/ios-keyboard.md.
 */
export function useKeyboardInsetRoot() {
  if (import.meta.server) {
    return
  }

  const {
    bottomInset,
    viewportHeight,
    isKeyboardOpen,
  } = useVisualViewportInset()
  const root = document.documentElement

  function clearKeyboardState() {
    root.style.removeProperty('--visible-height')
    root.removeAttribute('data-keyboard-open')
  }

  watchEffect(() => {
    if (!isKeyboardOpen.value) {
      root.style.setProperty('--keyboard-inset', '0px')
      clearKeyboardState()

      return
    }

    root.style.setProperty('--keyboard-inset', `${bottomInset.value}px`)
    root.style.setProperty('--visible-height', `${viewportHeight.value}px`)
    root.setAttribute('data-keyboard-open', '')
  })

  tryOnScopeDispose(() => {
    root.style.removeProperty('--keyboard-inset')
    clearKeyboardState()
  })
}
