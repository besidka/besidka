const COPIED_RESET_MS = 2000

export function useCurrentUrlCopy() {
  const route = useRoute()
  const { copy, copied } = useClipboard({
    legacy: true,
    copiedDuring: COPIED_RESET_MS,
  })

  const displayPath = computed<string>(() => {
    return route.fullPath
  })

  const currentUrl = computed<string>(() => {
    return new URL(route.fullPath, window.location.origin).href
  })

  async function copyUrl() {
    await copy(currentUrl.value)
  }

  return { displayPath, currentUrl, copied, copyUrl }
}
