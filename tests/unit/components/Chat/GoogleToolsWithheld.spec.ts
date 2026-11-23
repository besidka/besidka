import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { filterPublicParts } from '~~/server/utils/chats/share-public-parts'
import GoogleToolsWithheld from '../../../../app/components/Chat/GoogleToolsWithheld.vue'

function createMessage(parts: unknown[]): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function mountWithReason(reason: unknown) {
  return mountSuspended(GoogleToolsWithheld, {
    props: {
      message: createMessage([
        { type: 'data-google-tools-withheld', data: { reason } },
        { type: 'text', text: 'An answer.' },
      ]),
    },
  })
}

describe('Chat/GoogleToolsWithheld', () => {
  it('renders nothing without the part', async () => {
    const wrapper = await mountSuspended(GoogleToolsWithheld, {
      props: {
        message: createMessage([{ type: 'text', text: 'An answer.' }]),
      },
    })

    expect(wrapper.find('[data-testid="google-tools-withheld"]').exists())
      .toBe(false)
  })

  it('renders nothing for an unknown reason code', async () => {
    const wrapper = await mountWithReason('free text the server wrote')

    expect(wrapper.find('[data-testid="google-tools-withheld"]').exists())
      .toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('says the model may not receive Google data and links the keys page',
    async () => {
      const wrapper = await mountWithReason('model_may_not_receive_google_data')

      expect(wrapper.find('[data-testid="google-tools-withheld-summary"]')
        .text()).toContain('Google tools were not offered to this model.')
      expect(wrapper.find('[data-testid="google-tools-withheld-detail"]')
        .text()).toContain(
        'Besidka does not send Google data to a model that may use it for '
        + 'training. Pick another model, or confirm on the API Keys page '
        + 'that your Gemini key is a paid one.',
      )
      const link = wrapper.find('[data-testid="google-tools-withheld-link"]')

      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/profile/keys?provider=google')
    })

  it('says Google tools are not offered with a built-in provider tool',
    async () => {
      const wrapper = await mountWithReason('provider_tool_not_removable')

      expect(wrapper.find('[data-testid="google-tools-withheld-summary"]')
        .text()).toContain(
        'Google tools were not offered with a built-in provider tool.',
      )
      expect(wrapper.find('[data-testid="google-tools-withheld-detail"]')
        .text()).toContain(
        'Turn off the provider\'s built-in tool for this message (web '
        + 'search or Run code), or ask again after a Google file is in the '
        + 'chat.',
      )
      expect(wrapper.find('[data-testid="google-tools-withheld-link"]')
        .exists()).toBe(false)
    })

  it('starts collapsed', async () => {
    const wrapper = await mountWithReason('provider_tool_not_removable')

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it('renders nothing for a message as the shared view receives it',
    async () => {
      const [publicMessage] = filterPublicParts([createMessage([
        {
          type: 'data-google-tools-withheld',
          data: { reason: 'model_may_not_receive_google_data' },
        },
        { type: 'text', text: 'An answer.' },
      ])])
      const wrapper = await mountSuspended(GoogleToolsWithheld, {
        props: { message: publicMessage! },
      })

      expect(wrapper.find('[data-testid="google-tools-withheld"]').exists())
        .toBe(false)
    })
})
