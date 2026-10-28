import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import OAuthNotice from '../../../../app/components/Auth/OAuthNotice.vue'

describe('Auth/OAuthNotice', () => {
  it('states the age requirement and acceptance for OAuth sign-in', async () => {
    const wrapper = await mountSuspended(OAuthNotice)

    expect(wrapper.text().replace(/\s+/g, ' ')).toBe(
      'By continuing with Google or GitHub, you confirm you are 18 or over '
      + 'and accept the Terms of Use and Privacy Policy.',
    )
  })

  it('links to the Terms of Use and the Privacy Policy', async () => {
    const wrapper = await mountSuspended(OAuthNotice)
    const destinations = wrapper.findAll('a').map((link) => {
      return link.attributes('to') ?? link.attributes('href')
    })

    expect(destinations).toEqual(['/terms-of-use', '/privacy-policy'])
  })
})
