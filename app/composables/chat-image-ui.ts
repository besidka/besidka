import type { UIMessage } from 'ai'
import {
  type GenerateImageToolPart,
  getGenerateImageOutput,
  getGenerateImageToolPart,
  isVisibleGenerateImageToolPart,
  shouldRenderGenerateImageToolPart,
} from '~/utils/generated-images'

// Fed to ChatGeneratedImage before the real tool-generate_image part exists,
// so the same progress skeleton already covers the window between
// submitting an image-generation turn and the model actually calling the
// tool, instead of the generic loader disappearing with nothing to show.
const pendingToolPart: GenerateImageToolPart = {
  type: 'tool-generate_image',
  state: 'input-streaming',
}

export const pendingGenerateImagePart
  = pendingToolPart as unknown as UIMessage['parts'][number]

export function useChatImageUi(
  getMessages: () => UIMessage[],
  options: {
    isImageGenerationTurnPending?: () => boolean
    isLoading?: () => boolean
  } = {},
) {
  const isImageGenerationTurnPending
    = options.isImageGenerationTurnPending ?? (() => false)
  const isLoading = options.isLoading ?? (() => false)

  const hasActiveImageGenerationToolPart = computed<boolean>(() => {
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

  const shouldRenderPendingImageGeneration = computed<boolean>(() => {
    return isImageGenerationTurnPending()
      && isLoading()
      && !hasActiveImageGenerationToolPart.value
  })

  const hasImageGenerationProgress = computed<boolean>(() => {
    return hasActiveImageGenerationToolPart.value
      || shouldRenderPendingImageGeneration.value
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
    shouldRenderPendingImageGeneration,
    shouldFitMessageContent,
  }
}
