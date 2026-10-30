import { describe, expect, it, vi } from 'vitest'
import {
  generationInProgressKvKey,
  isChatGenerating,
} from '~~/server/utils/chats/generation-in-progress'

function createKv(keys: string[]) {
  return {
    list: vi.fn(async (options: { prefix: string }) => {
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
})
