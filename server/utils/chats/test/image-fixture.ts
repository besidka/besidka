import type { TextUIPart, UIMessage } from 'ai'
import type {
  GeneratedImageFile,
  ImageGenerationReady,
} from '#shared/types/image-generation.d'
import type { MessageUsage } from '#shared/types/message-usage.d'

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

function buildGenerateImageToolPart(
  idSeed: string,
): UIMessage['parts'][number] {
  const storageKey = `${idSeed}-sunset-mountain.png`
  const file: GeneratedImageFile = {
    id: `${idSeed}-file`,
    storageKey,
    name: 'sunset-mountain.png',
    size: 204800,
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
