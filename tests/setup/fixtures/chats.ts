import type { TestMessage } from './messages'
import { createMessageThread } from './messages'

/**
 * Test fixtures for chats
 */

export interface TestChat {
  slug: string
  title: string
  model: string
  createdAt: Date
  updatedAt: Date
  userId: string
  messages?: TestMessage[]
}

export function createMockChat(overrides: Partial<TestChat> = {}): TestChat {
  return {
    slug: 'chat-123',
    title: 'Test Chat',
    model: 'gpt-4',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    userId: 'user-123',
    messages: [],
    ...overrides,
  }
}

export const testChats = {
  empty: createMockChat({
    slug: 'chat-empty',
    title: 'Empty Chat',
    messages: [],
  }),
  withMessages: createMockChat({
    slug: 'chat-with-messages',
    title: 'Chat with Messages',
    messages: createMessageThread(3),
  }),
  gpt4: createMockChat({
    slug: 'chat-gpt4',
    title: 'GPT-4 Chat',
    model: 'gpt-4',
  }),
  gpt35: createMockChat({
    slug: 'chat-gpt35',
    title: 'GPT-3.5 Chat',
    model: 'gpt-3.5-turbo',
  }),
  claude: createMockChat({
    slug: 'chat-claude',
    title: 'Claude Chat',
    model: 'claude-3-opus-20240229',
  }),
}

export function createChatHistory(count: number = 10): TestChat[] {
  const chats: TestChat[] = []

  for (let i = 0; i < count; i++) {
    chats.push(
      createMockChat({
        slug: `chat-${i}`,
        title: `Chat ${i + 1}`,
        createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        messages: i % 2 === 0 ? createMessageThread(2) : [],
      }),
    )
  }

  return chats
}
