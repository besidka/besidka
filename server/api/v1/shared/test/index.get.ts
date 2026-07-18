import type { TextUIPart } from 'ai'
import {
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
        id: 'shared-test-image-assistant',
        role: 'assistant' as const,
        parts: buildTestSharedImageFileParts('shared-test-image-source-1'),
        reasoning: 'off' as const,
        createdAt: new Date().toISOString(),
        usage: TEST_IMAGE_USAGE,
        tools: ['image_generation'] as const,
      },
    ],
  }
})
