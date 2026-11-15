import type { AttachedArtifact } from '~/types/chat-input-tools'

/**
 * Text and an artifact waiting for the next composer that mounts.
 * `chat-input:prefill` and `chat-input:attach-artifact` only reach a composer
 * that already exists, so an action that navigates first (Ask to fix from
 * History → Artifacts) queues them here instead. The composer takes each on
 * mount, once.
 */
export function useChatInputPrefill() {
  const pendingText = useState<string | null>(
    'chat-input:pending-prefill',
    () => null,
  )
  const pendingArtifact = useState<AttachedArtifact | null>(
    'chat-input:pending-artifact',
    () => null,
  )

  function queue(text: string, artifact: AttachedArtifact | null = null) {
    pendingText.value = text
    pendingArtifact.value = artifact
  }

  function take(): string | null {
    const text = pendingText.value

    pendingText.value = null

    return text
  }

  function takeArtifact(): AttachedArtifact | null {
    const artifact = pendingArtifact.value

    pendingArtifact.value = null

    return artifact
  }

  return { queue, take, takeArtifact }
}
