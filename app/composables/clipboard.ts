export function useClipboardWithPaste() {
  async function paste() {
    try {
      const text = await navigator.clipboard.readText()

      return text.trim()
    } catch (_exception) {
      useErrorMessage('Failed to read clipboard text')
      return ''
    }
  }
  return { paste }
}
