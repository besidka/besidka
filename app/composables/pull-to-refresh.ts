import { defu } from 'defu'

interface PullToRefreshOptions {
  threshold?: MaybeRefOrGetter<number>
  resistance?: MaybeRefOrGetter<number>
  disabled?: MaybeRefOrGetter<boolean>
}

interface PullToRefreshReturn {
  isPulling: Readonly<Ref<boolean>>
  isRefreshing: Readonly<Ref<boolean>>
  pullDistance: Readonly<Ref<number>>
  canPull: Readonly<Ref<boolean>>
}

export function usePullToRefresh(
  options: PullToRefreshOptions = {},
): PullToRefreshReturn {
  const target = computed<HTMLElement | null>(() => document.body)
  const { threshold, resistance, disabled } = defu(options, {
    threshold: 50,
    resistance: 2,
    disabled: false,
  })

  const isPulling = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const pullDistance = shallowRef<number>(0)
  const startY = shallowRef<number>(0)
  const currentY = shallowRef<number>(0)

  const canPull = computed<boolean>(() => {
    if (import.meta.server) {
      return false
    }

    const element = toValue(target)

    if (!element || toValue(disabled)) {
      return false
    }

    const isAtTop = window.scrollY <= 1

    return isAtTop
  })

  if (import.meta.server) {
    return {
      isPulling: readonly(isPulling),
      isRefreshing: readonly(isRefreshing),
      pullDistance: readonly(pullDistance),
      canPull: readonly(canPull),
    }
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0]

    if (!touch) return

    startY.value = touch.clientY
    currentY.value = startY.value

    isPulling.value = false
    pullDistance.value = 0

    // Check scroll position directly to avoid stale computed values
    const isAtTopNow = window.scrollY <= 1
    const element = toValue(target)

    if (!isAtTopNow || !element || toValue(disabled) || isRefreshing.value) {
      startY.value = -1 // Mark as invalid touch start
      return
    }
  }

  function handleTouchMove(event: TouchEvent) {
    if (startY.value === -1 || isRefreshing.value) {
      return
    }

    const touch = event.touches[0]

    if (!touch) {
      return
    }

    currentY.value = touch.clientY

    const deltaY = currentY.value - startY.value

    if (deltaY <= 0) {
      isPulling.value = false
      pullDistance.value = 0
      return
    }

    pullDistance.value = Math.min(
      deltaY / toValue(resistance), toValue(threshold) * 1.5,
    )
    isPulling.value = pullDistance.value > 10

    if (isPulling.value && event.cancelable) {
      event.preventDefault()
    }
  }

  async function handleTouchEnd() {
    if (startY.value === -1) {
      return
    }

    if (pullDistance.value < toValue(threshold)) {
      isPulling.value = false
      pullDistance.value = 0
      return
    }

    isRefreshing.value = true

    await nextTick()
    await reloadNuxtApp({
      force: true,
    })
  }

  function cleanup() {
    isPulling.value = false
    isRefreshing.value = false
    pullDistance.value = 0
  }

  useEventListener(target, 'touchstart', handleTouchStart, { passive: true })
  useEventListener(target, 'touchmove', handleTouchMove, { passive: false })
  useEventListener(target, 'touchend', handleTouchEnd, { passive: true })
  useEventListener(target, 'touchcancel', cleanup, { passive: true })

  onUnmounted(cleanup)

  return {
    isPulling: readonly(isPulling),
    isRefreshing: readonly(isRefreshing),
    pullDistance: readonly(pullDistance),
    canPull: readonly(canPull),
  }
}
