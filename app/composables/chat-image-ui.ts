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

const gatewayFailureToolPart: GenerateImageToolPart = {
  type: 'tool-generate_image',
  state: 'output-error',
}

export const gatewayImageGenerationFailurePart
  = gatewayFailureToolPart as unknown as UIMessage['parts'][number]

export function useChatImageUi(
  getMessages: () => UIMessage[],
  options: {
    isImageGenerationTurnPending?: () => boolean
    isTurnActive?: () => boolean
    isGatewaySendTurnPending?: () => boolean
    isTurnStopped?: () => boolean
  } = {},
) {
  const isImageGenerationTurnPending
    = options.isImageGenerationTurnPending ?? (() => false)
  const isTurnActive = options.isTurnActive ?? (() => false)
  const isGatewaySendTurnPending
    = options.isGatewaySendTurnPending ?? (() => false)
  const isTurnStopped = options.isTurnStopped ?? (() => false)

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

  // Streamed reasoning must NOT dismiss the pending skeleton: models that
  // reason before calling the tool would otherwise unmount it while no real
  // tool part exists yet, shrinking the content below the pinned user
  // message and letting the browser clamp scrollTop down (visible jump).
  // Only content that visually replaces the skeleton dismisses it: a
  // renderable image tool part (the real skeleton, result, or error card),
  // a file part, and — direct providers only — non-empty text. A gateway
  // send returns text and the image from the SAME completion (text first,
  // then the image part, or the other way around), so text must NOT dismiss
  // the card there: the card is meant to sit at the end of the message,
  // surviving any streamed text/reasoning, until a file part (or the end of
  // the turn) resolves it.
  const hasPendingImageDismissingContent = computed<boolean>(() => {
    const message = getMessages().at(-1)

    if (!message || message.role !== 'assistant') {
      return false
    }

    return message.parts.some((part) => {
      if (part.type === 'file') {
        return true
      }

      if (part.type === 'text' && !isGatewaySendTurnPending()) {
        return Boolean(part.text?.trim().length)
      }

      return isVisibleGenerateImageToolPart(part)
    })
  })

  const lastMessageIsAssistant = computed<boolean>(() => {
    return getMessages().at(-1)?.role === 'assistant'
  })

  const shouldMergePendingImageIntoRealMessage = computed<boolean>(() => {
    return isGatewaySendTurnPending() && lastMessageIsAssistant.value
  })

  const shouldRenderPendingImageGeneration = computed<boolean>(() => {
    return isImageGenerationTurnPending()
      && isTurnActive()
      && !hasPendingImageDismissingContent.value
      && !shouldMergePendingImageIntoRealMessage.value
  })

  const shouldRenderPendingImageGenerationInline = computed<boolean>(() => {
    return isImageGenerationTurnPending()
      && isTurnActive()
      && !hasPendingImageDismissingContent.value
      && shouldMergePendingImageIntoRealMessage.value
  })

  const isImageGenerationSkeletonVisible = computed<boolean>(() => {
    return shouldRenderPendingImageGeneration.value
      || shouldRenderPendingImageGenerationInline.value
  })

  const shouldRenderGatewayImageGenerationFailure = computed<boolean>(() => {
    if (
      !isImageGenerationTurnPending()
      || !isGatewaySendTurnPending()
      || isTurnActive()
      || isTurnStopped()
      || !lastMessageIsAssistant.value
      || hasPendingImageDismissingContent.value
    ) {
      return false
    }

    const message = getMessages().at(-1)

    return !message?.parts.some(part => isChatErrorTextPart(part))
  })

  const hasImageGenerationProgress = computed<boolean>(() => {
    return hasActiveImageGenerationToolPart.value
      || isImageGenerationSkeletonVisible.value
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
    shouldRenderPendingImageGenerationInline,
    shouldRenderGatewayImageGenerationFailure,
    isImageGenerationSkeletonVisible,
    shouldFitMessageContent,
  }
}
