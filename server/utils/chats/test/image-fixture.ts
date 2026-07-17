import type { FileUIPart, SourceUrlUIPart, TextUIPart } from 'ai'
import type { MessageUsage } from '#shared/types/message-usage.d'

export const TEST_IMAGE_PROMPT: string
  = 'Generate an image of a mountain at sunset.'

export const TEST_IMAGE_REPLY: string
  = 'Here is your generated image of a mountain at sunset.'

export const TEST_IMAGE_DATA_URL: string
  = 'data:image/png;base64,'
    + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4'
    + '2mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export const TEST_IMAGE_USAGE: MessageUsage = {
  model: 'google/gemini-2.5-flash-image',
  provider: 'google',
  inputTokens: 24,
  outputTokens: 1290,
  totalTokens: 1314,
  inputCost: 0.0002,
  outputCost: 0.0193,
}

export function buildTestImageAssistantParts(
  sourceId: string,
): Array<FileUIPart | TextUIPart | SourceUrlUIPart> {
  return [
    {
      type: 'file',
      mediaType: 'image/png',
      filename: 'sunset-mountain.png',
      url: TEST_IMAGE_DATA_URL,
    },
    {
      type: 'text',
      text: TEST_IMAGE_REPLY,
    },
    {
      type: 'source-url',
      sourceId,
      url: 'https://example.com/mountain-reference',
      title: 'Reference photograph',
    },
  ]
}
