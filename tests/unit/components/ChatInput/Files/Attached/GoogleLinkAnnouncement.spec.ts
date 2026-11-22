import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GoogleLinkAnnouncement from '../../../../../../app/components/ChatInput/Files/Attached/GoogleLinkAnnouncement.vue'

describe('ChatInput/Files/Attached/GoogleLinkAnnouncement', () => {
  it('keeps one polite live region that is empty without a link', async () => {
    const wrapper = await mountSuspended(GoogleLinkAnnouncement, {
      props: { count: 0 },
    })
    const status = wrapper.get('[data-testid="google-link-announcement"]')

    expect(status.text()).toBe('')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.classes()).toContain('sr-only')
  })

  it('receives the text in the same element when a link appears', async () => {
    const wrapper = await mountSuspended(GoogleLinkAnnouncement, {
      props: { count: 0 },
    })
    const status = wrapper.get('[data-testid="google-link-announcement"]')

    await wrapper.setProps({ count: 1 })

    expect(wrapper.get('[data-testid="google-link-announcement"]').element)
      .toBe(status.element)
    expect(status.text()).toBe(
      'A Google file link in your message can be attached.',
    )

    await wrapper.setProps({ count: 3 })

    expect(status.text()).toBe(
      '3 Google file links in your message can be attached.',
    )
  })

  it('says nothing about the Picker, since there is no helper text', async () => {
    const wrapper = await mountSuspended(GoogleLinkAnnouncement, {
      props: { count: 2 },
    })

    expect(wrapper.text()).not.toContain('Picker')
  })
})
