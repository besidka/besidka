import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AccountEmailList from '../../../../app/components/content/AccountEmailList.vue'

describe('AccountEmailList.vue', () => {
  it('renders the four ordered items with their labels', async () => {
    const wrapper = await mountSuspended(AccountEmailList)
    const items = wrapper.findAll('li')

    expect(wrapper.find('ol[data-testid="account-email-list"]').exists())
      .toBe(true)
    expect(items).toHaveLength(4)
    expect(items[0]?.find('strong').text()).toBe('Address and password:')
    expect(items[1]?.find('strong').text()).toBe('Account deletion:')
    expect(items[2]?.find('strong').text()).toBe('Security notices')
    expect(items[3]?.find('strong').text()).toBe('Legal notices:')
  })

  it('renders the registry phrases as visible text', async () => {
    const wrapper = await mountSuspended(AccountEmailList)
    const text = wrapper.text()

    expect(text).toContain(
      'email address verification, password reset and confirmation of a new '
      + 'email address.',
    )
    expect(text).toContain(
      'a confirmation link when you ask to delete your account.',
    )
    expect(text).toContain(
      ', when something on your account changes: your password was changed, '
      + 'a sign-in method was connected or disconnected, ',
    )
    expect(text).toContain(', or an app was connected to your account.')
    expect(text).toContain(
      'a notice of a significant change to the Privacy Policy, the Terms of '
      + 'Use or the Cookie Policy, sent to every account with a verified '
      + 'email address that exists when the notice is published (if you sign '
      + 'up after that, you agree to the new text). The notice is published '
      + 'on the page and in the app first, at least 30 days before the '
      + 'change takes effect (14 days if the law or security requires it), '
      + 'and emails go out from then on, a limited number a day, so yours '
      + 'can arrive a few days after publication.',
    )
  })
})
