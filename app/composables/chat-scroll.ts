export function useChatScroll() {
  const {
    measure, y, arrivedState, directions,
  } = useWindowScroll({
    behavior: 'smooth',
  })
  const { top: scrollDirectionToTop } = toRefs(directions)
  const interval = ref<NodeJS.Timeout | null>(null)

  watch(scrollDirectionToTop, () => {
    if (interval.value) clearInterval(interval.value)
  }, {
    immediate: false,
    flush: 'post',
  })

  function scrollToBottom() {
    if (import.meta.server) return

    measure()
    nextTick(() => {
      y.value += Number.MAX_SAFE_INTEGER
    })
  }

  onMounted(() => {
    // It's not a bug, it's a feature
    // Needed especially for the PWA mode
    // Scroll to bottom on page load works only after 2 animation frames
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    })
  })

  const nuxtApp = useNuxtApp()

  nuxtApp.hook('chat:submit', scrollToBottom)

  return {
    scrollToBottom,
    arrivedState,
    scrollInterval: interval,
  }
}
