export function useDeviceSafeArea() {
  const { top, bottom } = useScreenSafeArea()

  const safeAreaTop = computed<number>(() => {
    return parseInt(top.value) || 0
  })

  const safeAreaBottom = computed<number>(() => {
    return parseInt(bottom.value) || 0
  })

  const hasSafeAreaTop = computed<boolean>(() => {
    return safeAreaTop.value > 0
  })

  const hasSafeAreaBottom = computed<boolean>(() => {
    return safeAreaBottom.value > 0
  })

  return {
    safeAreaTop,
    safeAreaBottom,
    hasSafeAreaTop,
    hasSafeAreaBottom,
  }
}
