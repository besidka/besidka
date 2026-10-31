import { reactive, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useLegalNoticeVisibility,
} from '../../../../app/composables/legal-notice-banner'
import ChangeNotice from '../../../../app/components/Legal/ChangeNotice.client.vue'

const NOTICE_ID = '2026-11-legal-notices'
const USER_ID = 42
const DISMISSED_KEY = `legal-notice:dismissed:${USER_ID}:${NOTICE_ID}`
const PUBLISHED_AT = '2026-10-31T06:00:00Z'
const ACTIVE_UNTIL = '2026-12-18T00:00:00Z'
const BANNER = '[data-testid="legal-change-notice"]'
const DISMISS = '[data-testid="legal-change-notice-dismiss"]'

const store = new Map<string, string>()
const loggedIn = ref<boolean>(true)
const user = ref<{ id: number } | null>({ id: USER_ID })
const route = reactive<{ name: string }>({ name: 'chats-new' })
const isPreferencesAllowed = vi.fn(() => false)

const storageShim = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value))
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
}

const throwingStorageShim = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {},
}

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn, user })
})

mockNuxtImport('useRoute', () => {
  return () => route
})

mockNuxtImport('useCookieConsent', () => {
  return () => ({ isAllowed: isPreferencesAllowed })
})

enableAutoUnmount(afterEach)

function installStorage(storage: object): void {
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  })
}

async function mountNotice() {
  const wrapper = await mountSuspended(ChangeNotice)

  await flushPromises()

  return wrapper
}

function setNow(isoDate: string): void {
  vi.setSystemTime(new Date(isoDate))
}

describe('Legal change notice', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    setNow('2026-11-05T12:00:00Z')
    store.clear()
    clearNuxtState('legal-notice:dismissed-session')
    clearNuxtState('legal-notice:is-visible')
    installStorage(storageShim)
    isPreferencesAllowed.mockClear()
    route.name = 'chats-new'
    loggedIn.value = true
    user.value = { id: USER_ID }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders for the active notice with the documents and date', async () => {
    const wrapper = await mountNotice()
    const banner = wrapper.find(BANNER)

    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain(
      'Changes to the Privacy Policy and Terms of Use take effect on '
      + '4 December 2026.',
    )
    expect(banner.text()).toContain('See what changes')
  })

  it('uses a polite status role and a soft info alert', async () => {
    const wrapper = await mountNotice()
    const alert = wrapper.find('[role="status"]')

    expect(alert.exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(alert.classes()).toEqual(
      expect.arrayContaining(['alert', 'alert-info', 'alert-soft']),
    )
  })

  it('links to the change history of the first changed document', async () => {
    const wrapper = await mountNotice()
    const link = wrapper.find('[data-testid="legal-change-notice-link"]')

    expect(link.attributes('to')).toBe('/privacy-policy#change-history')
  })

  it('gives the dismiss button an accessible label', async () => {
    const wrapper = await mountNotice()
    const dismiss = wrapper.find(DISMISS)

    expect(dismiss.exists()).toBe(true)
    expect(dismiss.attributes('aria-label')).toBe('Dismiss notice')
  })

  it('positions the banner above the page background gradient', async () => {
    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).classes()).toContain('relative')
  })

  it('shows the dismiss tooltip on the left', async () => {
    const wrapper = await mountNotice()
    const tooltip = wrapper.find('.tooltip')

    expect(tooltip.exists()).toBe(true)
    expect(tooltip.classes()).toContain('tooltip-left')
    expect(tooltip.classes()).not.toContain('tooltip-bottom')
  })

  it('hides and remembers the dismissal per notice id', async () => {
    const wrapper = await mountNotice()

    await wrapper.find(DISMISS).trigger('click')
    await flushPromises()

    expect(store.get(DISMISSED_KEY)).toBe('1')
    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('stays hidden when the notice was dismissed earlier', async () => {
    store.set(DISMISSED_KEY, '1')

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('keeps a dismissal to the account that made it', async () => {
    store.set(DISMISSED_KEY, '1')
    user.value = { id: USER_ID + 1 }

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(true)

    await wrapper.find(DISMISS).trigger('click')
    await flushPromises()

    expect(store.get(
      `legal-notice:dismissed:${USER_ID + 1}:${NOTICE_ID}`,
    )).toBe('1')
  })

  it('stays hidden until the account is known', async () => {
    user.value = null

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('stays hidden before the notice is published', async () => {
    setNow('2026-10-31T05:59:59Z')

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('shows from the exact publication instant', async () => {
    setNow(PUBLISHED_AT)

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(true)
  })

  it('shows until 14 days after the effective date', async () => {
    setNow('2026-12-17T23:59:59Z')

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(true)
  })

  it('hides from 14 days after the effective date', async () => {
    setNow(ACTIVE_UNTIL)

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('stays hidden for signed-out visitors', async () => {
    loggedIn.value = false

    const wrapper = await mountNotice()

    expect(wrapper.find(BANNER).exists()).toBe(false)
  })

  it('persists the dismissal with preferences consent declined', async () => {
    const wrapper = await mountNotice()

    await wrapper.find(DISMISS).trigger('click')
    await flushPromises()

    expect(isPreferencesAllowed).not.toHaveBeenCalled()
    expect(store.get(DISMISSED_KEY)).toBe('1')

    clearNuxtState('legal-notice:dismissed-session')

    const remounted = await mountNotice()

    expect(remounted.find(BANNER).exists()).toBe(false)
  })

  it('keeps the dismissal for the session when storage throws', async () => {
    installStorage(throwingStorageShim)

    const wrapper = await mountNotice()

    await wrapper.find(DISMISS).trigger('click')
    await flushPromises()

    expect(wrapper.find(BANNER).exists()).toBe(false)

    const remounted = await mountNotice()

    expect(remounted.find(BANNER).exists()).toBe(false)
  })

  it('does not add a top safe-area inset outside the chat page', async () => {
    const wrapper = await mountNotice()
    const classes = wrapper.find(BANNER).classes()

    expect(classes).toContain('pt-2')
    expect(classes.some(name => name.includes('--sat'))).toBe(false)
  })

  it('adds the top safe-area inset on the chat page', async () => {
    route.name = 'chats-slug'

    const wrapper = await mountNotice()
    const classes = wrapper.find(BANNER).classes()

    expect(classes).not.toContain('pt-2')
    expect(classes.some(name => name.includes('--sat'))).toBe(true)
  })

  it('flags the banner as visible and clears it on dismiss', async () => {
    const isVisible = useLegalNoticeVisibility()
    const wrapper = await mountNotice()

    expect(isVisible.value).toBe(true)

    await wrapper.find(DISMISS).trigger('click')
    await flushPromises()

    expect(isVisible.value).toBe(false)
  })

  it('clears the visible flag when unmounted', async () => {
    const isVisible = useLegalNoticeVisibility()
    const wrapper = await mountNotice()

    expect(isVisible.value).toBe(true)

    wrapper.unmount()

    expect(isVisible.value).toBe(false)
  })
})
