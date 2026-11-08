/**
 * Whether the "Pin sidebar" toggle is offered: only on desktop, where the
 * pill hides itself on hover, and never with reduced motion, where it never
 * hides. Shared by the ⋯ More menu and the User menu on chat pages.
 */
export function useSidebarPinToggle() {
  const { isDesktop } = useDevice()
  const reducedMotion = usePreferredReducedMotion()

  const showPinToggle = computed<boolean>(() => {
    return isDesktop && reducedMotion.value !== 'reduce'
  })

  return { showPinToggle }
}
