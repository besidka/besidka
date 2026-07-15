import type { UIMessage } from 'ai'
import {
  getGenerateImageOutput,
  getGenerateImageToolPart,
  isVisibleGenerateImageToolPart,
  shouldRenderGenerateImageToolPart,
} from '~/utils/generated-images'

export function useChatImageUi(getMessages: () => UIMessage[]) {
  const hasImageGenerationProgress = computed<boolean>(() => {
    const message = getMessages().at(-1)

    if (!message || message.role !== 'assistant') {
      return false
    }

    return message.parts.some((part) => {
      if (!shouldRenderGenerateImageToolPart(message, part)) {
        return false
      }

      const toolPart = getGenerateImageToolPart(part)
      const output = getGenerateImageOutput(part)

      if (
        toolPart?.state === 'input-streaming'
        || toolPart?.state === 'input-available'
      ) {
        return true
      }

      return output?.status === 'generating' || output?.status === 'saving'
    })
  })

  function shouldFitMessageContent(message: UIMessage): boolean {
    if (message.role !== 'assistant') {
      return false
    }

    let hasImageContent = false

    for (const part of message.parts) {
      if (part.type === 'text') {
        if (part.text.trim()) {
          return false
        }

        continue
      }

      if (part.type === 'reasoning') {
        if (part.text.trim()) {
          return false
        }

        continue
      }

      if (part.type === 'step-start') {
        continue
      }

      if (part.type === 'file') {
        if (!part.mediaType.startsWith('image/')) {
          return false
        }

        hasImageContent = true

        continue
      }

      if (isVisibleGenerateImageToolPart(part)) {
        hasImageContent = true

        continue
      }

      return false
    }

    return hasImageContent
  }

  return {
    hasImageGenerationProgress,
    shouldFitMessageContent,
  }
}
