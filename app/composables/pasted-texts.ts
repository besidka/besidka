import type { PastedText } from '~/utils/pasted-text'

export function usePastedTexts() {
  return useState<PastedText[]>('chat-input-pasted-texts', () => [])
}
