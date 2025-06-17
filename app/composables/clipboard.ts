export function useClipboardWithPaste() {
  async function paste() {
    try {
      return await navigator.clipboard.readText()
    } catch (_exception) {
      useErrorMessage('Failed to read clipboard text')
      return ''
    }
  }
  return { paste }
}
