import type { FileUIPart, TextUIPart, UIMessage } from 'ai'
import type {
  GeneratedImageFile,
  ImageGenerationReady,
} from '#shared/types/image-generation.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { markUrlAsGeneratedFile } from '#shared/utils/files'

export const TEST_IMAGE_PROMPT: string
  = 'Generate an image of a mountain at sunset.'

export const TEST_IMAGE_REPLY: string
  = 'Here is your generated image of a mountain at sunset.'

export const TEST_IMAGE_USAGE: MessageUsage = {
  model: 'google/gemini-2.5-flash-image',
  provider: 'google',
  inputTokens: 24,
  outputTokens: 1290,
  totalTokens: 1314,
  inputCost: 0.0002,
  outputCost: 0.0193,
}

export const TEST_IMAGE_FIXTURE_STORAGE_KEY_SUFFIX: string
  = '-sunset-mountain.png'

export const TEST_IMAGE_FIXTURE_SIZE: number = 4760

export function isTestImageFixtureStorageKey(storageKey: string): boolean {
  return storageKey.endsWith(TEST_IMAGE_FIXTURE_STORAGE_KEY_SUFFIX)
}

function buildGenerateImageToolPart(
  idSeed: string,
): UIMessage['parts'][number] {
  const storageKey = `${idSeed}${TEST_IMAGE_FIXTURE_STORAGE_KEY_SUFFIX}`
  const file: GeneratedImageFile = {
    id: `${idSeed}-file`,
    storageKey,
    name: 'sunset-mountain.png',
    size: TEST_IMAGE_FIXTURE_SIZE,
    type: 'image/png',
    source: 'assistant',
    url: `/files/${storageKey}`,
    downloadUrl: `/files/${storageKey}?download=1`,
  }
  const output: ImageGenerationReady = {
    status: 'ready',
    provider: 'google',
    model: TEST_IMAGE_USAGE.model,
    file,
  }

  return {
    type: 'tool-generate_image',
    toolCallId: `${idSeed}-tool-call`,
    state: 'output-available',
    input: {
      prompt: TEST_IMAGE_PROMPT,
      aspectRatio: '3:2',
    },
    output,
  } as UIMessage['parts'][number]
}

export function buildTestImageAssistantParts(
  idSeed: string,
): Array<TextUIPart | UIMessage['parts'][number]> {
  return [
    buildGenerateImageToolPart(idSeed),
    {
      type: 'text',
      text: TEST_IMAGE_REPLY,
    },
  ]
}

// Deliberately a different shape from buildTestImageAssistantParts() above.
// server/utils/files/assistant-files.ts's normalizeGeneratedImageToolParts()
// rewrites a generated image's tool-generate_image part into a plain,
// markUrlAsGeneratedFile()-tagged `file` part before it's ever persisted, and
// server/api/v1/shared/[slug]/index.get.ts's filterPublicParts() strips tool
// parts from the public response — so a real shared-chat page only ever sees
// the `file` shape, rendered by ChatFiles.vue (size-48, 192px) rather than
// ChatGeneratedImage.vue (w-80, 320px). Only /chats/test (personal chat)
// should use buildTestImageAssistantParts(); this is what /shared/test needs
// to faithfully reproduce the real shared-page layout.
export function buildTestSharedImageFileParts(idSeed: string): FileUIPart[] {
  const storageKey = `${idSeed}${TEST_IMAGE_FIXTURE_STORAGE_KEY_SUFFIX}`

  return [{
    type: 'file',
    mediaType: 'image/png',
    filename: 'sunset-mountain.png',
    url: markUrlAsGeneratedFile(`/files/${storageKey}`),
  }]
}
