export function useStandaloneDisplay() {
  const isDisplayModeStandalone = useMediaQuery('(display-mode: standalone)')
  const isIosStandalone = shallowRef<boolean>(false)

  onMounted(() => {
    isIosStandalone.value = isNavigatorStandalone()
  })

  const isStandalone = computed<boolean>(() => {
    return isDisplayModeStandalone.value || isIosStandalone.value
  })

  return { isStandalone }
}
