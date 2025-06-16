// import { randomUUID } from 'node:crypto'
// import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
// import { ulid } from 'ulid'
// import * as schema from '../../../../../db/schema'

const { OPENAI_API_KEY, OPENAI_API_PROJECT_KEY } = process.env

export function useOpenAI(model: string) {
  const openai = createOpenAI({
    apiKey: OPENAI_API_KEY,
    project: OPENAI_API_PROJECT_KEY,
  })

  function getInstance() {
    return openai(model)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  return {
    instance: getInstance(),
    generateChatTitle,
  }
}
