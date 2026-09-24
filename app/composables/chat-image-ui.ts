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

// A gateway send has no tool call to report a structured error code through
// — if the turn ends with neither an image nor any other visible content,
// this generic failure card replaces silence with the same error state a
// direct-provider generation failure shows (see GeneratedImage.vue's
// `isFailure` branch). `errorText` is deliberately omitted so
// `getImageGenerationFailureText` falls back to its generic copy, since
// there is no structured `ChatErrorPayload` to read a code from here.
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
  // non-empty text, or a file part.
  const hasPendingImageDismissingContent = computed<boolean>(() => {
    const message = getMessages().at(-1)

    if (!message || message.role !== 'assistant') {
      return false
    }

    return message.parts.some((part) => {
      if (part.type === 'file') {
        return true
      }

      if (part.type === 'text') {
        return Boolean(part.text?.trim().length)
      }

      return isVisibleGenerateImageToolPart(part)
    })
  })

  // A gateway send (OpenRouter/Vercel) streams reasoning straight into the
  // real assistant message from the first chunk — there is no tool call to
  // wait for. Once that real message exists, the pending skeleton belongs
  // inside it (see `shouldRenderPendingImageGenerationInline`) rather than
  // in a second, separately-positioned bubble below it. Direct-provider
  // sends never merge: their pending skeleton always stays the standalone
  // bubble until a real tool-generate_image part replaces it.
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

  // The turn ended (not active, not user-stopped) after requesting image
  // generation on a gateway send, and the real assistant message shows
  // nothing that would explain it — no image, no text, no visible tool
  // part, and no chat-level error banner already covering it. This only
  // catches the stream-time case: a page reload after such a silent turn
  // has no persisted marker to reconstruct this card from, since
  // `getImageGenerationStreamFailure` (server/utils/files/assistant-files.ts)
  // only persists a failure notice when the stream itself errored, not when
  // it completed cleanly without producing an image.
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
