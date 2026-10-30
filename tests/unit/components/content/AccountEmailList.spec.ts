import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AccountEmailList from '../../../../app/components/content/AccountEmailList.vue'

describe('AccountEmailList.vue', () => {
  it('renders the three ordered items with their labels', async () => {
    const wrapper = await mountSuspended(AccountEmailList)
    const items = wrapper.findAll('li')

    expect(wrapper.find('ol[data-testid="account-email-list"]').exists())
      .toBe(true)
    expect(items).toHaveLength(3)
    expect(items[0]?.find('strong').text()).toBe('Address and password:')
    expect(items[1]?.find('strong').text()).toBe('Account deletion:')
    expect(items[2]?.find('strong').text()).toBe('Security notices')
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
  })
})
