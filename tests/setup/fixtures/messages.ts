/**
 * Test fixtures for chat messages
 */

export interface TestMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
}

export function createMockMessage(
  overrides: Partial<TestMessage> = {},
): TestMessage {
  return {
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    role: 'user',
    content: 'Test message content',
    createdAt: new Date(),
    ...overrides,
  }
}

export const testMessages = {
  userMessage: createMockMessage({
    id: 'msg-user-1',
    role: 'user',
    content: 'Hello, how can you help me?',
  }),
  assistantMessage: createMockMessage({
    id: 'msg-assistant-1',
    role: 'assistant',
    content: 'I can help you with various tasks. What do you need?',
  }),
  systemMessage: createMockMessage({
    id: 'msg-system-1',
    role: 'system',
    content: 'You are a helpful assistant.',
  }),
}

export function createMessageThread(count: number = 5): TestMessage[] {
  const messages: TestMessage[] = []

  for (let i = 0; i < count; i++) {
    messages.push(
      createMockMessage({
        id: `msg-user-${i}`,
        role: 'user',
        content: `User message ${i + 1}`,
        createdAt: new Date(Date.now() - (count - i) * 60000),
      }),
    )

    messages.push(
      createMockMessage({
        id: `msg-assistant-${i}`,
        role: 'assistant',
        content: `Assistant response ${i + 1}`,
        createdAt: new Date(Date.now() - (count - i - 0.5) * 60000),
      }),
    )
  }

  return messages
}
