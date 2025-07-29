export function useChatScroll() {
  const messagesContainer = useState<HTMLDivElement | null>(
    'messagesContainer',
    () => null,
  )

  const {
    measure, y, arrivedState, directions,
  } = useScroll(messagesContainer, {
    behavior: 'smooth',
    offset: {
      bottom: 200,
    },
  })
  const { top: scrollDirectionToTop } = toRefs(directions)
  const interval = ref<NodeJS.Timeout | null>(null)

  watch(scrollDirectionToTop, () => {
    interval.value && clearInterval(interval.value)
  }, {
    immediate: false,
    flush: 'post',
  })

  function scrollToBottom() {
    if (import.meta.server) return

    measure()
    y.value += Number.MAX_SAFE_INTEGER
  }

  return {
    messagesContainer,
    scrollToBottom,
    arrivedState,
    scrollInterval: interval,
  }
}
