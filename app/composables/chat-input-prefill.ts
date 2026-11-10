/**
 * Text waiting for the next composer that mounts. `chat-input:prefill` only
 * reaches a composer that already exists, so an action that navigates first
 * (Ask to fix from History → Artifacts) queues its text here instead. The
 * composer takes it on mount, once.
 */
export function useChatInputPrefill() {
  const pendingText = useState<string | null>(
    'chat-input:pending-prefill',
    () => null,
  )

  function queue(text: string) {
    pendingText.value = text
  }

  function take(): string | null {
    const text = pendingText.value

    pendingText.value = null

    return text
  }

  return { queue, take }
}
