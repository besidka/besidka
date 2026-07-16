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
    const isLoading = shallowRef<boolean>(true)
    const {
      hasImageGenerationProgress,
      shouldRenderPendingImageGeneration,
    } = useChatImageUi(() => messages.value, {
      isImageGenerationTurnPending: () => true,
      isLoading: () => isLoading.value,
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
      isLoading: () => true,
    })

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
    expect(hasImageGenerationProgress.value).toBe(false)
  })

  it('stops the pending skeleton once the turn resolves without a tool part', () => {
    const userMessage = createMessage('user-1', 'user', [{
      type: 'text',
      text: 'Generate an image of a cat',
    }])
    const messages = shallowRef<UIMessage[]>([userMessage])
    const isLoading = shallowRef<boolean>(true)
    const { shouldRenderPendingImageGeneration } = useChatImageUi(
      () => messages.value,
      {
        isImageGenerationTurnPending: () => true,
        isLoading: () => isLoading.value,
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
    isLoading.value = false

    expect(shouldRenderPendingImageGeneration.value).toBe(false)
  })
})
