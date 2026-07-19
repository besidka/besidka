export function useImagePreviewGuard() {
  const guardCount = useState<number>('image-preview-guard-count', () => 0)

  const isSuppressed = computed<boolean>(() => guardCount.value > 0)

  function suppressImagePreview() {
    guardCount.value += 1
  }

  function releaseImagePreview() {
    guardCount.value = Math.max(0, guardCount.value - 1)
  }

  return {
    isSuppressed,
    suppressImagePreview,
    releaseImagePreview,
  }
}
