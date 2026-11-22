import { describe, expect, it, vi } from 'vitest'
import {
  generationInProgressKvKey,
  isChatGenerating,
  listChatGenerationLeases,
} from '~~/server/utils/chats/generation-in-progress'

function createKv(keys: string[]) {
  return {
    list: vi.fn(async (options: { prefix: string, limit?: number }) => {
      return {
        keys: keys
          .filter(key => key.startsWith(options.prefix))
          .map(name => ({ name })),
      }
    }),
  }
}

describe('generation in progress', () => {
  it('builds the per-message key the send route writes', () => {
    expect(generationInProgressKvKey('chat1', 'message1'))
      .toBe('chat-generating:chat1:message1')
  })

  it('is true while any message of the chat holds the flag', async () => {
    const kv = createKv([generationInProgressKvKey('chat1', 'message1')])

    await expect(isChatGenerating('chat1', kv)).resolves.toBe(true)
    expect(kv.list).toHaveBeenCalledWith({
      prefix: 'chat-generating:chat1:',
      limit: 1,
    })
  })

  it('is false for a chat without a flag, even when another has one',
    async () => {
      const kv = createKv([generationInProgressKvKey('chat2', 'message1')])

      await expect(isChatGenerating('chat1', kv)).resolves.toBe(false)
    })

  it('does not match a chat id that only shares a prefix', async () => {
    const kv = createKv([generationInProgressKvKey('chat12', 'message1')])

    await expect(isChatGenerating('chat1', kv)).resolves.toBe(false)
  })

  it('lists the user message ids that hold a lease for the chat',
    async () => {
      const kv = createKv([
        generationInProgressKvKey('chat1', 'message1'),
        generationInProgressKvKey('chat1', 'message2'),
        generationInProgressKvKey('chat12', 'message3'),
      ])

      await expect(listChatGenerationLeases('chat1', kv))
        .resolves.toEqual(['message1', 'message2'])
      expect(kv.list).toHaveBeenCalledWith({
        prefix: 'chat-generating:chat1:',
        limit: 10,
      })
    })
})
