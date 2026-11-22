import type { UIMessage } from 'ai'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ReplyStopped from '../../../../app/components/Chat/ReplyStopped.vue'
import { createReplyStoppedPart } from '#shared/utils/chat-reply-stopped'

function message(parts: unknown[]): UIMessage {
  return { id: 'assistant-1', role: 'assistant', parts } as UIMessage
}

describe('Chat/ReplyStopped', () => {
  it('ends a stopped reply without answer text with a neutral line',
    async () => {
      const wrapper = await mountSuspended(ReplyStopped, {
        props: {
          message: message([
            { type: 'reasoning', text: 'Looking it up' },
            createReplyStoppedPart(),
          ]),
        },
      })

      expect(wrapper.get('[data-testid="reply-stopped"]').text())
        .toBe('Stopped.')
      expect(wrapper.find('.alert-error').exists()).toBe(false)
    })

  it('adds nothing to a stopped reply that has text', async () => {
    const wrapper = await mountSuspended(ReplyStopped, {
      props: {
        message: message([
          { type: 'text', text: 'Half an answer' },
          createReplyStoppedPart(),
        ]),
      },
    })

    expect(wrapper.find('[data-testid="reply-stopped"]').exists()).toBe(false)
  })
})
