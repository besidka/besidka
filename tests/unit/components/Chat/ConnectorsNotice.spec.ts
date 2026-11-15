import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import ConnectorsNotice from '../../../../app/components/Chat/ConnectorsNotice.vue'

function createMessage(parts: unknown[]): UIMessage {
  return { id: 'msg-1', role: 'assistant', parts } as UIMessage
}

describe('Chat/ConnectorsNotice', () => {
  it('renders nothing without the notice part', async () => {
    const wrapper = await mountSuspended(ConnectorsNotice, {
      props: { message: createMessage([{ type: 'text', text: 'Answer' }]) },
    })

    expect(wrapper.find('[data-testid="connectors-notice"]').exists())
      .toBe(false)
  })

  it('renders each line as muted plain text', async () => {
    const wrapper = await mountSuspended(ConnectorsNotice, {
      props: {
        message: createMessage([{
          type: 'data-connectors-notice',
          data: {
            lines: [
              'Connectors are off for this message',
              '<b>Notion</b> was skipped',
            ],
          },
        }]),
      },
    })
    const lines = wrapper.findAll('[data-testid="connectors-notice-line"]')

    expect(lines).toHaveLength(2)
    expect(lines[0]!.text()).toBe('Connectors are off for this message')
    expect(lines[1]!.text()).toBe('<b>Notion</b> was skipped')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.get('[data-testid="connectors-notice"]').classes())
      .toContain('text-base-content/60')
  })
})
