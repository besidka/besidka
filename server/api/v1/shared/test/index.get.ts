import type { TextUIPart } from 'ai'
import {
  buildTestHiddenFilePart,
  buildTestSharedImageFileParts,
  TEST_IMAGE_PROMPT,
  TEST_IMAGE_USAGE,
} from '~~/server/utils/chats/test/image-fixture'

export default defineEventHandler(() => {
  const isCiEnvironment: boolean = process.env.CI === 'true'
  const isTestSharedEndpointEnabled: boolean
    = import.meta.dev || isCiEnvironment

  if (!isTestSharedEndpointEnabled) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not found',
    })
  }

  return {
    title: 'Shared Test Chat',
    indexable: false,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    author: {
      name: 'Test Author',
      image: null,
    },
    messages: [
      {
        id: 'shared-test-image-user',
        role: 'user' as const,
        parts: [
          { type: 'text', text: TEST_IMAGE_PROMPT },
        ] as TextUIPart[],
        reasoning: 'off' as const,
      },
      {
        id: 'shared-test-hidden-file-assistant',
        role: 'assistant' as const,
        parts: buildTestHiddenFilePart(),
        reasoning: 'off' as const,
        createdAt: new Date().toISOString(),
        usage: TEST_IMAGE_USAGE,
        tools: ['image_generation'] as const,
      },
      {
        id: 'shared-test-image-assistant',
        role: 'assistant' as const,
        parts: buildTestSharedImageFileParts('shared-test-image-source-1'),
        reasoning: 'off' as const,
        createdAt: new Date().toISOString(),
        usage: TEST_IMAGE_USAGE,
        tools: ['image_generation'] as const,
      },
      {
        id: 'shared-test-long-metadata-user',
        role: 'user' as const,
        parts: [
          { type: 'text', text: 'What is the weather in Kyiv?' },
        ] as TextUIPart[],
        reasoning: 'off' as const,
      },
      {
        id: 'shared-test-long-metadata-assistant',
        role: 'assistant' as const,
        parts: [
          { type: 'text', text: 'It is sunny in Kyiv today.' },
        ] as TextUIPart[],
        reasoning: 'off' as const,
        createdAt: new Date().toISOString(),
        usage: {
          model:
            '@cf/deepseek-ai/deepseek-v4-flash-0325-instruct-experimental',
          provider: 'cloudflare-gateway',
          inputTokens: 128,
          outputTokens: 256,
          totalTokens: 384,
          inputCost: 0.0005,
          outputCost: 0.0015,
          searchUnits: 3,
          searchBillingUnit: 'search' as const,
          searchCost: 0.015,
          searchProvider: 'brave' as const,
        },
        tools: ['web_search_brave'] as const,
      },
    ],
  }
})
