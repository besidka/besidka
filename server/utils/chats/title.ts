import type { LanguageModel } from 'ai'
import { generateText } from 'ai'

export async function useChatTitle(
  model: LanguageModel,
  message: string,
) {
  const instructions: string[] = [
    `Generate a concise and descriptive title for a chat based on the following user's message`,
    'The chat title should be less than 30 characters long.',
    `Don't use quotes (' or ") or colons (:) or any other punctuation and special characters.`,
    `Don't use markdown, just plain text`,
  ]

  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'system',
        content: instructions.join('.\n -'),
      },
      {
        role: 'user',
        content: message,
      },
    ],
  })

  return text
}
