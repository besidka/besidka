import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GoogleStep from '../../../../../app/components/Chat/Reasoning/GoogleStep.vue'

const LINK = 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz'
const ICON = { kind: 'iconify', name: 'lucide:hard-drive' } as const

function data(overrides: Record<string, unknown> = {}) {
  return {
    toolName: 'google__drive_read_file',
    state: 'done',
    references: [{
      id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      title: 'Plan.md',
      link: LINK,
      date: '2026-11-20T10:00:00.000Z',
    }],
    ...overrides,
  }
}

async function mountStep(
  stepData: ReturnType<typeof data>,
  pending = false,
) {
  return await mountSuspended(GoogleStep, {
    props: {
      data: stepData as never,
      title: 'Read a file from Google Drive',
      pending,
      icon: ICON,
    },
  })
}

describe('Chat/Reasoning/GoogleStep', () => {
  it('shows the title and the file with an Open in Google Drive link',
    async () => {
      const wrapper = await mountStep(data())
      const link = wrapper.get('[data-testid="reasoning-google-step-link"]')

      expect(wrapper.get('[data-testid="reasoning-google-step-title"]').text())
        .toBe('Read a file from Google Drive')
      expect(wrapper.get('[data-testid="reasoning-google-step-reference"]')
        .text()).toContain('Plan.md')
      expect(link.attributes('href')).toBe(LINK)
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
      expect(link.text()).toBe('Open in Google Drive')
    })

  it('shows the name with no link when the stored link is missing',
    async () => {
      const wrapper = await mountStep(data({
        references: [{ id: 'a', title: 'Plan.md', link: '', date: '' }],
      }))

      expect(wrapper.find('[data-testid="reasoning-google-step-link"]')
        .exists()).toBe(false)
      expect(wrapper.text()).toContain('Plan.md')
    })

  it('falls back to a generic name for a reference without a title',
    async () => {
      const wrapper = await mountStep(data({
        references: [{ id: 'a', title: '', link: LINK, date: '' }],
      }))

      expect(wrapper.text()).toContain('Google Drive file')
    })

  it('shows no empty box when the call has no references', async () => {
    const wrapper = await mountStep(data({ references: [] }))

    expect(wrapper.find('[data-testid="reasoning-google-step-references"]')
      .exists()).toBe(false)
  })

  it('shows no references while the call runs or after it failed',
    async () => {
      for (const state of ['working', 'failed']) {
        const wrapper = await mountStep(data({ state }), state === 'working')

        expect(wrapper.find('[data-testid="reasoning-google-step-references"]')
          .exists()).toBe(false)
      }
    })

  it('marks the title while the call is pending', async () => {
    const wrapper = await mountStep(data({ state: 'working' }), true)

    expect(wrapper.get('[data-testid="reasoning-google-step-title"]').text())
      .toContain('…')
  })

  it('shows an email thread by its date with an Open in Gmail link and no '
    + 'mail text', async () => {
    const threadLink = 'https://mail.google.com/mail/#all/18c0ffee'
    const wrapper = await mountSuspended(GoogleStep, {
      props: {
        data: {
          toolName: 'google__gmail_search',
          state: 'done',
          references: [{
            id: '18c0ffee',
            kind: 'gmail-thread',
            title: '',
            link: threadLink,
            date: '2026-11-21T10:00:00.000Z',
          }],
        } as never,
        title: 'Searched Gmail',
        pending: false,
        icon: { kind: 'iconify', name: 'lucide:mail' },
      },
    })
    const link = wrapper.get('[data-testid="reasoning-google-step-link"]')

    expect(wrapper.get('[data-testid="reasoning-google-step-reference"]')
      .text()).toContain('Email thread from 2026-11-21')
    expect(link.text()).toBe('Open in Gmail')
    expect(link.attributes('href')).toBe(threadLink)
    expect(link.attributes('aria-label'))
      .toBe('Open the email thread from 2026-11-21 in Gmail')
    expect(wrapper.text()).not.toContain('Google Drive')
  })
})
