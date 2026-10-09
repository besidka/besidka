import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import RememberPrompt from '../../../../app/components/Cookies/RememberPrompt.client.vue'
import {
  useCookieConsent,
} from '../../../../modules/cookie-consent/src/runtime/composables/consent'

const PROMPT = '[data-testid="cookies-remember-prompt"]'
const REMEMBER = '[data-testid="cookies-remember"]'
const NOT_NOW = '[data-testid="cookies-remember-dismiss"]'
const CLOSE = `${PROMPT} .absolute button`

function resetToUndecided(): void {
  useState<boolean>('cookie-consent:decided').value = false
  useState<string[]>('cookie-consent:granted').value = ['necessary']
  useState<string | null>('cookie-consent:request').value = null
}

function openRequest(): void {
  useState<string | null>('cookie-consent:request').value = 'preferences'
}

describe('Cookies/RememberPrompt.client', () => {
  beforeEach(() => {
    resetToUndecided()
  })

  it('is hidden while there is no request', async () => {
    const wrapper = await mountSuspended(RememberPrompt)

    expect(wrapper.get(PROMPT).classes()).toContain('!hidden')

    wrapper.unmount()
  })

  it('shows the message and both choices for a request', async () => {
    const wrapper = await mountSuspended(RememberPrompt)

    openRequest()
    await nextTick()

    expect(wrapper.get(PROMPT).classes()).not.toContain('!hidden')
    expect(wrapper.get(PROMPT).text()).toContain(
      'cookieConsent.prompt.message',
    )
    expect(wrapper.get(REMEMBER).text()).toContain(
      'cookieConsent.prompt.remember',
    )
    expect(wrapper.get(NOT_NOW).text()).toContain(
      'cookieConsent.prompt.notNow',
    )

    wrapper.unmount()
  })

  it('offers Remember and Not now with identical button classes', async () => {
    const wrapper = await mountSuspended(RememberPrompt)

    openRequest()
    await nextTick()

    const rememberClass = wrapper.get(REMEMBER).attributes('class')
    const notNowClass = wrapper.get(NOT_NOW).attributes('class')

    expect(rememberClass).toBe(notNowClass)

    wrapper.unmount()
  })

  it('Remember grants preferences, decides, and hides the prompt', async () => {
    const wrapper = await mountSuspended(RememberPrompt)
    const { granted, isDecided } = useCookieConsent()

    openRequest()
    await nextTick()
    await wrapper.get(REMEMBER).trigger('click')

    expect(granted.value).toContain('preferences')
    expect(isDecided.value).toBe(true)
    expect(wrapper.get(PROMPT).classes()).toContain('!hidden')

    wrapper.unmount()
  })

  it('Not now hides the prompt without deciding', async () => {
    const wrapper = await mountSuspended(RememberPrompt)
    const { granted, isDecided } = useCookieConsent()

    openRequest()
    await nextTick()
    await wrapper.get(NOT_NOW).trigger('click')

    expect(granted.value).not.toContain('preferences')
    expect(isDecided.value).toBe(false)
    expect(wrapper.get(PROMPT).classes()).toContain('!hidden')

    wrapper.unmount()
  })

  it('the close button hides the prompt without deciding', async () => {
    const wrapper = await mountSuspended(RememberPrompt)
    const { isDecided } = useCookieConsent()

    openRequest()
    await nextTick()
    await wrapper.get(CLOSE).trigger('click')

    expect(isDecided.value).toBe(false)
    expect(wrapper.get(PROMPT).classes()).toContain('!hidden')

    wrapper.unmount()
  })

  it('clears the request on route change', async () => {
    const wrapper = await mountSuspended(RememberPrompt)
    const router = useRouter()

    openRequest()
    await nextTick()

    expect(wrapper.get(PROMPT).classes()).not.toContain('!hidden')

    await router.push('/signin')
    await nextTick()

    expect(wrapper.get(PROMPT).classes()).toContain('!hidden')
    expect(useState<string | null>('cookie-consent:request').value)
      .toBeNull()

    wrapper.unmount()
  })
})
