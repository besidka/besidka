export function useAnimateAppear() {
  const mounted = shallowRef<boolean>(false)
  const visible = shallowRef<boolean>(false)

  onMounted(() => {
    setTimeout(() => {
      visible.value = true
    }, 100)
    setTimeout(() => {
      mounted.value = true
    }, 600)
  })

  onBeforeUnmount(() => {
    mounted.value = false
  })

  return {
    mounted,
    visible,
  }
}
