import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GmailDraft from '../../../../../app/components/Chat/Reasoning/GmailDraft.vue'
import type { GmailDraftApprovalView } from '#shared/utils/google-gmail-draft-view'

function view(
  overrides: Partial<GmailDraftApprovalView> = {},
): GmailDraftApprovalView {
  return {
    to: ['alice@example.test'],
    cc: [],
    bcc: [],
    subject: 'Lunch plans',
    body: 'Noon?',
    cardBody: 'Noon?',
    lineCount: 1,
    isReply: false,
    ...overrides,
  }
}

function testId(name: string): string {
  return `[data-testid="reasoning-approval-step-gmail-draft-${name}"]`
}

describe('Chat/Reasoning/GmailDraft', () => {
  it('lists only the recipient rows that have addresses', async () => {
    const wrapper = await mountSuspended(GmailDraft, {
      props: { view: view({ bcc: ['hidden@example.test'] }) },
    })

    expect(wrapper.get(testId('to')).text()).toBe('alice@example.test')
    expect(wrapper.find(testId('cc')).exists()).toBe(false)
    expect(wrapper.get(testId('bcc')).text()).toBe('hidden@example.test')
  })

  it('says how long the message is and whether it is a reply', async () => {
    const single = await mountSuspended(GmailDraft, {
      props: { view: view() },
    })
    const reply = await mountSuspended(GmailDraft, {
      props: { view: view({ lineCount: 3, isReply: true }) },
    })

    expect(single.get(testId('lines')).text()).toBe('Message · 1 line')
    expect(reply.get(testId('lines')).text())
      .toBe('Message (a reply in the thread above) · 3 lines')
  })

  it('shows the body in a focusable region and that nothing is sent',
    async () => {
      const wrapper = await mountSuspended(GmailDraft, {
        props: { view: view({ cardBody: 'Line one\nLine two' }) },
      })
      const body = wrapper.get(testId('body'))

      expect(body.attributes('tabindex')).toBe('0')
      expect(body.attributes('aria-label')).toBe('Draft message')
      expect(body.text()).toContain('Line two')
      expect(wrapper.get(testId('note')).text())
        .toContain('Besidka cannot send it')
    })
})
