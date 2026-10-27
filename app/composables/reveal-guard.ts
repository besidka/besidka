import type { InjectionKey, ShallowRef } from 'vue'

export const REVEAL_GUARD_DURATION_MS = 400

interface RevealGuardRoot {
  isInitialRender: ShallowRef<boolean>
}

const revealGuardRootKey: InjectionKey<RevealGuardRoot>
  = Symbol('tools-menu-reveal-guard')

/**
 * Marks the subtree below the calling component as one menu whose first
 * render is already on screen. Controls mounted in that first render are never
 * guarded; controls mounted later are, see `useRevealGuard`.
 */
export function provideRevealGuardRoot() {
  const isInitialRender = shallowRef<boolean>(true)

  provide(revealGuardRootKey, { isInitialRender })

  onMounted(() => {
    isInitialRender.value = false
  })
}

/**
 * A control that appears under the pointer after the user acted on another
 * control must not take the click that was meant for the control that just
 * moved. Returns `isGuarded`, true for `REVEAL_GUARD_DURATION_MS` after a
 * control mounts late, and always false for controls present when the menu
 * first rendered or rendered outside a guard root.
 */
export function useRevealGuard() {
  const root = inject(revealGuardRootKey, null)
  const isGuarded = shallowRef<boolean>(false)

  if (!root || root.isInitialRender.value) {
    return { isGuarded }
  }

  isGuarded.value = true

  let timer: ReturnType<typeof setTimeout> | undefined

  onMounted(() => {
    timer = setTimeout(() => {
      isGuarded.value = false
    }, REVEAL_GUARD_DURATION_MS)
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
  })

  return { isGuarded }
}
