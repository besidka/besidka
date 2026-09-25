import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import ErrorCard from '../../../../app/components/Chat/ErrorCard.vue'

function mountErrorCard(error: ChatErrorPayload | null) {
  return mountSuspended(ErrorCard, {
    props: { error },
  })
}

describe('Chat/ErrorCard', () => {
  it('renders nothing when there is no error', async () => {
    const wrapper = await mountErrorCard(null)

    expect(wrapper.find('.alert').exists()).toBe(false)
  })

  it('renders the message, why, fix and request id as separate lines', async () => {
    const wrapper = await mountErrorCard({
      code: 'provider-unavailable',
      message: 'The provider is unavailable.',
      why: 'The provider rejected the request.',
      fix: 'Try again later.',
      requestId: 'req-123',
    })
    const alert = wrapper.get('.alert.alert-error')
    const lines = alert.findAll('p').map(paragraph => paragraph.text())

    expect(lines).toEqual([
      'The provider is unavailable.',
      'The provider rejected the request.',
      'Try again later.',
      'Request ID: req-123',
    ])
  })

  it('shows only the message when nothing else is set', async () => {
    const wrapper = await mountErrorCard({
      code: 'unknown',
      message: 'Image generation failed. Revise the prompt or try a'
        + ' different provider.',
    })
    const lines = wrapper.findAll('p').map(paragraph => paragraph.text())

    expect(lines).toEqual([
      'Image generation failed. Revise the prompt or try a different'
      + ' provider.',
    ])
  })

  it('prefers the provider request id over the request id', async () => {
    const wrapper = await mountErrorCard({
      code: 'unknown',
      message: 'Something failed.',
      requestId: 'req-123',
      providerRequestId: 'provider-req-456',
    })
    const lines = wrapper.findAll('p').map(paragraph => paragraph.text())

    expect(lines).toEqual([
      'Something failed.',
      'Provider request ID: provider-req-456',
    ])
  })
})
