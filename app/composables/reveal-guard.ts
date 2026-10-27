import type { InjectionKey, ShallowRef } from 'vue'

export const REVEAL_GUARD_DURATION_MS = 400

interface RevealGuardRoot {
  isInitialRender: ShallowRef<boolean>
}

interface RevealScope {
  isGuarded: ShallowRef<boolean>
}

const revealGuardRootKey: InjectionKey<RevealGuardRoot>
  = Symbol('tools-menu-reveal-guard')

const revealScopeKey: InjectionKey<RevealScope>
  = Symbol('tools-menu-reveal-scope')

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
 * Marks the controls below the calling component as one region that can be
 * revealed without being mounted. When `isOpen` turns true after the menu's
 * first render, every control in the region is guarded for
 * `REVEAL_GUARD_DURATION_MS`, exactly as a control that mounts late is.
 * Regions open on the first render, or outside a guard root, never guard.
 */
export function provideRevealScope(isOpen: () => boolean) {
  const root = inject(revealGuardRootKey, null)
  const isGuarded = shallowRef<boolean>(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  provide(revealScopeKey, { isGuarded })

  watch(isOpen, (isOpenNow) => {
    clearTimeout(timer)
    isGuarded.value = false

    if (!isOpenNow || !root) {
      return
    }

    isGuarded.value = true
    timer = setTimeout(() => {
      isGuarded.value = false
    }, REVEAL_GUARD_DURATION_MS)
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
  })
}

/**
 * A control that appears under the pointer after the user acted on another
 * control must not take the click that was meant for the control that just
 * moved. Returns `isGuarded`, true for `REVEAL_GUARD_DURATION_MS` after a
 * control mounts late or its enclosing reveal scope opens, and always false
 * for controls present when the menu first rendered or rendered outside a
 * guard root.
 *
 * Only pointer activation is ever ignored: a keyboard user cannot hit a
 * control that moved under the pointer, so Space and arrow keys act at once.
 * `shouldIgnoreActivation` tells the two apart, from a `pointerdown` seen
 * since the last `keydown` or from the click's own `detail`. Bind
 * `onPointerDown` and `onKeyDown` on the element that wraps the control.
 */
export function useRevealGuard() {
  const root = inject(revealGuardRootKey, null)
  const scope = inject(revealScopeKey, null)
  const isMountGuarded = shallowRef<boolean>(false)
  let isPointerActivation = false

  const isGuarded = computed<boolean>(() => {
    return isMountGuarded.value || scope?.isGuarded.value === true
  })

  function onPointerDown() {
    isPointerActivation = true
  }

  function onKeyDown() {
    isPointerActivation = false
  }

  function shouldIgnoreActivation(event?: MouseEvent): boolean {
    const isPointer = isPointerActivation || (event?.detail ?? 0) > 0

    return isGuarded.value && isPointer
  }

  const guard = {
    isGuarded,
    onPointerDown,
    onKeyDown,
    shouldIgnoreActivation,
  }

  if (!root || root.isInitialRender.value) {
    return guard
  }

  isMountGuarded.value = true

  let timer: ReturnType<typeof setTimeout> | undefined

  onMounted(() => {
    timer = setTimeout(() => {
      isMountGuarded.value = false
    }, REVEAL_GUARD_DURATION_MS)
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
  })

  return guard
}
