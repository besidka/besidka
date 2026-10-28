import type { UIMessage } from 'ai'
import { shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { useChatImageUi } from '../../../app/composables/chat-image-ui'

function createMessage(
  id: string,
  role: UIMessage['role'],
  parts: UIMessage['parts'],
): UIMessage {
  return { id, role, parts }
}

function createPastChatPreRetrievalChipPart(): UIMessage['parts'][number] {
  return {
    type: 'tool-search_chats',
    toolCallId: 'past-chat-pre-retrieval-user-1',
    state: 'output-available',
    input: { query: 'cat' },
    output: {
      notice: 'The content below is quoted excerpts of the user\'s past '
        + 'chats.',
      results: [{
        chatId: 'chat-1',
        title: 'My cat',
        url: '/chats/chat-1',
        role: 'user',
        date: '2026-10-01',
      }],
    },
  }
}

describe('useChatImageUi', () => {
  it('suppresses the generic loader only for trailing image progress', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image',
    }])
    const progressMessage = createMessage('assistant-1', 'assistant', [{
      type: 'tool-generate_image',
      state: 'output-available',
      input: { aspectRatio: '1:1' },
      output: { status: 'generating' },
    }])
    const messages = shallowRef<UIMessage[]>([
      userMessage,
      progressMessage,
    ])
    const { hasImageGenerationProgress } = useChatImageUi(() => {
      return messages.value
    })

    expect(hasImageGenerationProgress.value).toBe(true)

    messages.value = [
      userMessage,
      progressMessage,
      createMessage('user-2', 'user', [{
        type: 'text',
        text: 'Tell me something else',
      }]),
    ]

    expect(hasImageGenerationProgress.value).toBe(false)
  })

  it('shows the generic loader again after image progress finishes', () => {
    const messages = shallowRef<UIMessage[]>([
      createMessage('assistant-1', 'assistant', [{
        type: 'tool-generate_image',
        state: 'output-error',
        errorText: JSON.stringify({ code: 'provider-unavailable' }),
      }]),
    ])
    const { hasImageGenerationProgress } = useChatImageUi(() => {
      return messages.value
    })

    expect(hasImageGenerationProgress.value).toBe(false)
  })

  it('fits an assistant bubble containing only generated image content', () => {
    const { shouldFitMessageContent } = useChatImageUi(() => [])
    const message = createMessage('assistant-1', 'assistant', [
      {
        type: 'step-start',
      },
      {
        type: 'tool-generate_image',
        state: 'output-available',
        output: { status: 'generating' },
      },
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'generated.webp',
        url: '/files/generated.webp',
      },
    ])

    expect(shouldFitMessageContent(message)).toBe(true)
  })

  it('keeps text and non-image file bubbles at their normal width', () => {
    const { shouldFitMessageContent } = useChatImageUi(() => [])
    const textMessage = createMessage('assistant-1', 'assistant', [{
      type: 'text',
      text: 'Here is your image',
    }])
    const fileMessage = createMessage('assistant-2', 'assistant', [{
      type: 'file',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
      url: '/files/report.pdf',
    }])

    expect(shouldFitMessageContent(textMessage)).toBe(false)
    expect(shouldFitMessageContent(fileMessage)).toBe(false)
  })

  it('renders the pending image skeleton before any tool part exists', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const isTurnActive = shallowRef<boolean>(true)
    const {
      hasImageGenerationProgress,
      shouldRenderPendingImageGeneration,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => isTurnActive.value,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(true)
    expect(hasImageGenerationProgress.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'tool-generate_image',
        state: 'input-streaming',
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(hasImageGenerationProgress.value).toBe(true)
  })

  it('keeps the pending skeleton while only reasoning is streaming', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const {
      hasImageGenerationProgress,
      shouldRenderPendingImageGeneration,
      shouldRenderPendingImageGenerationInline,
      isImageGenerationSkeletonVisible,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => true,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'reasoning',
        text: 'Choosing a scene and lighting for this request.',
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(true)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)
    expect(hasImageGenerationProgress.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [
        {
          type: 'reasoning',
          text: 'Choosing a scene and lighting for this request.',
        },
        {
          type: 'tool-generate_image',
          state: 'input-streaming',
        },
      ]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(false)
    expect(hasImageGenerationProgress.value).toBe(true)
  })

  it('stops the pending skeleton when assistant text streams mid-turn', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const { shouldRenderPendingImageGeneration } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => true,
      },
    )

    expect(shouldRenderPendingImageGeneration.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'text',
        text: 'I cannot generate images right now.',
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
  })

  it('stops the pending skeleton when the tool part fails', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const { shouldRenderPendingImageGeneration } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => true,
      },
    )

    expect(shouldRenderPendingImageGeneration.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'tool-generate_image',
        state: 'output-error',
        errorText: JSON.stringify({ code: 'provider-unavailable' }),
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
  })

  it('does not render the pending skeleton for a non-image turn', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Tell me a joke',
    }])
    const {
      hasImageGenerationProgress,
      shouldRenderPendingImageGeneration,
    } = useChatImageUi(() => [userMessage], {
      isImageGenerationTurnPending: () => false,
      isTurnActive: () => true,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(hasImageGenerationProgress.value).toBe(false)
  })

  it('merges the pending skeleton into the real assistant message for a '
    + 'gateway send, instead of a second bubble', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const {
      shouldRenderPendingImageGeneration,
      shouldRenderPendingImageGenerationInline,
      isImageGenerationSkeletonVisible,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => true,
      isGatewaySendTurnPending: () => true,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(true)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(false)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'reasoning',
        text: 'Choosing a scene and lighting for this request.',
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(true)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [
        {
          type: 'reasoning',
          text: 'Choosing a scene and lighting for this request.',
        },
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: 'data:image/webp;base64,AAAA',
        },
      ]),
    ]

    expect(shouldRenderPendingImageGenerationInline.value).toBe(false)
    expect(isImageGenerationSkeletonVisible.value).toBe(false)
  })

  it('merges a direct-provider send into the real message once it '
    + 'exists, instead of a second bubble', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const {
      shouldRenderPendingImageGeneration,
      shouldRenderPendingImageGenerationInline,
      isImageGenerationSkeletonVisible,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => true,
      isGatewaySendTurnPending: () => false,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(true)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(false)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'reasoning',
        text: 'Choosing a scene and lighting for this request.',
      }]),
    ]

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(true)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)
  })

  it('renders the pending card inline when a direct send starts with the '
    + 'past-chat pre-retrieval chip', () => {
    const messages = shallowRef<UIMessage[]>([
      createMessage('user-1', 'user', [{
        type: 'text',
        text: 'Fill this room with everything you know about me',
      }]),
      createMessage('assistant-1', 'assistant', [
        createPastChatPreRetrievalChipPart(),
      ]),
    ])
    const {
      shouldRenderPendingImageGeneration,
      shouldRenderPendingImageGenerationInline,
      isImageGenerationSkeletonVisible,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => true,
      isGatewaySendTurnPending: () => false,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(shouldRenderPendingImageGenerationInline.value).toBe(true)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)
  })

  it('never renders a second assistant container while the last message '
    + 'is an assistant message, for direct and gateway sends', () => {
    const reasoningPart: UIMessage['parts'][number] = {
      type: 'reasoning',
      text: 'Choosing a scene and lighting for this request.',
    }
    const earlyPartSequences: Record<string, UIMessage['parts']> = {
      'empty': [],
      'chip only': [createPastChatPreRetrievalChipPart()],
      'reasoning only': [reasoningPart],
      'chip and reasoning': [
        createPastChatPreRetrievalChipPart(),
        { type: 'step-start' },
        reasoningPart,
      ],
    }

    for (const isGatewaySend of [false, true]) {
      for (const [label, parts] of Object.entries(earlyPartSequences)) {
        const messages: UIMessage[] = [
          createMessage('user-1', 'user', [{
            type: 'text',
            text: 'Generate an image of a cat',
          }]),
          createMessage('assistant-1', 'assistant', parts),
        ]
        const {
          shouldRenderPendingImageGeneration,
          shouldRenderPendingImageGenerationInline,
        } = useChatImageUi(() => messages, {
          isImageGenerationTurnPending: () => true,
          isTurnActive: () => true,
          isGatewaySendTurnPending: () => isGatewaySend,
        })
        const caseName = `${label}, gateway: ${isGatewaySend}`

        expect(shouldRenderPendingImageGeneration.value, caseName)
          .toBe(false)
        expect(shouldRenderPendingImageGenerationInline.value, caseName)
          .toBe(true)
      }
    }
  })

  it('shows the generic failure card when a gateway image turn ends in '
    + 'silence — no image, no text, no chat error banner', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'reasoning',
        text: 'Choosing a scene and lighting for this request.',
      }]),
    ])
    const isTurnActive = shallowRef<boolean>(true)
    const { shouldRenderGatewayImageGenerationFailure } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => isTurnActive.value,
        isGatewaySendTurnPending: () => true,
        isTurnStopped: () => false,
      },
    )

    expect(shouldRenderGatewayImageGenerationFailure.value).toBe(false)

    isTurnActive.value = false

    expect(shouldRenderGatewayImageGenerationFailure.value).toBe(true)
  })

  it('shows the failure card when a gateway turn ends with text but no '
    + 'image, since the pending card promised one at the end of the '
    + 'message', () => {
    const messages = shallowRef<UIMessage[]>([
      createMessage('user-1', 'user', [{
        type: 'text',
        text: 'Generate an image of a cat',
      }]),
      createMessage('assistant-1', 'assistant', [{
        type: 'text',
        text: 'I cannot generate images right now.',
      }]),
    ])
    const { shouldRenderGatewayImageGenerationFailure } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => false,
        isGatewaySendTurnPending: () => true,
        isTurnStopped: () => false,
      },
    )

    expect(shouldRenderGatewayImageGenerationFailure.value).toBe(true)
  })

  it('does not dismiss the pending skeleton on streamed text for a '
    + 'gateway send, only on a file part', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([
      userMessage,
      createMessage('assistant-1', 'assistant', [{
        type: 'text',
        text: 'Here is your cat, generated as requested.',
      }]),
    ])
    const {
      shouldRenderPendingImageGenerationInline,
      isImageGenerationSkeletonVisible,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isTurnActive: () => true,
      isGatewaySendTurnPending: () => true,
    })

    expect(shouldRenderPendingImageGenerationInline.value).toBe(true)
    expect(isImageGenerationSkeletonVisible.value).toBe(true)

    messages.value = [
      userMessage,
      createMessage('assistant-1', 'assistant', [
        {
          type: 'text',
          text: 'Here is your cat, generated as requested.',
        },
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: 'data:image/webp;base64,AAAA',
        },
      ]),
    ]

    expect(shouldRenderPendingImageGenerationInline.value).toBe(false)
    expect(isImageGenerationSkeletonVisible.value).toBe(false)
  })

  it('does not show the failure card when the user stopped the turn', () => {
    const messages = shallowRef<UIMessage[]>([
      createMessage('user-1', 'user', [{
        type: 'text',
        text: 'Generate an image of a cat',
      }]),
      createMessage('assistant-1', 'assistant', []),
    ])
    const { shouldRenderGatewayImageGenerationFailure } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => false,
        isGatewaySendTurnPending: () => true,
        isTurnStopped: () => true,
      },
    )

    expect(shouldRenderGatewayImageGenerationFailure.value).toBe(false)
  })

  it('does not show the failure card for a direct-provider send', () => {
    const messages = shallowRef<UIMessage[]>([
      createMessage('user-1', 'user', [{
        type: 'text',
        text: 'Generate an image of a cat',
      }]),
      createMessage('assistant-1', 'assistant', []),
    ])
    const { shouldRenderGatewayImageGenerationFailure } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => false,
        isGatewaySendTurnPending: () => false,
        isTurnStopped: () => false,
      },
    )

    expect(shouldRenderGatewayImageGenerationFailure.value).toBe(false)
  })

  it('stops the pending skeleton once the turn resolves without a tool part', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const isTurnActive = shallowRef<boolean>(true)
    const { shouldRenderPendingImageGeneration } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isTurnActive: () => isTurnActive.value,
      },
    )

    expect(shouldRenderPendingImageGeneration.value).toBe(true)

    isTurnActive.value = false

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
  })
})
