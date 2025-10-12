export function useChatScroll() {
  const {
    measure, y, arrivedState, directions,
  } = useWindowScroll({
    behavior: 'smooth',
    offset: {
      bottom: 200,
    },
  })
  const { top: scrollDirectionToTop } = toRefs(directions)
  const interval = ref<NodeJS.Timeout | null>(null)

  watch(scrollDirectionToTop, () => {
    if (interval.value) clearInterval(interval.value)
  }, {
    immediate: false,
    flush: 'post',
  })

  onMounted(() => {
    measure()
  })

  function scrollToBottom() {
    if (import.meta.server) return

    measure()
    y.value += Number.MAX_SAFE_INTEGER
  }

  return {
    scrollToBottom,
    arrivedState,
    scrollInterval: interval,
  }
}
