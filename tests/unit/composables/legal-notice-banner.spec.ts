import { defineComponent } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import {
  formatLegalDocumentList,
  getLegalNoticeHref,
  removeLegacyLegalNoticeDismissals,
  useLegalNoticeBanner,
} from '../../../app/composables/legal-notice-banner'

const [NOTICE] = LEGAL_NOTICES
const USER_ID = 42
const LEGACY_KEY = `legal-notice:dismissed:${USER_ID}:${NOTICE.id}`

const {
  dismissLegalNoticeMock,
  fetchMock,
  isSettingsLoaded,
  dismissedLegalNoticeIds,
  loggedIn,
  user,
} = vi.hoisted(() => ({
  dismissLegalNoticeMock: vi.fn(),
  fetchMock: vi.fn(),
  isSettingsLoaded: { value: true },
  dismissedLegalNoticeIds: { value: [] as string[] },
  loggedIn: { value: true },
  user: { value: { id: 42 } as { id: number } | null },
}))

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useAuth', async () => {
  const { computed } = await import('vue')

  return () => ({
    loggedIn: computed(() => loggedIn.value),
    user: computed(() => user.value),
  })
})

mockNuxtImport('useUserSetting', async () => {
  const { computed } = await import('vue')

  return () => ({
    isSettingsLoaded: computed(() => isSettingsLoaded.value),
    dismissedLegalNoticeIds: computed(() => dismissedLegalNoticeIds.value),
    dismissLegalNotice: dismissLegalNoticeMock,
  })
})

enableAutoUnmount(afterEach)

const BannerProbe = defineComponent({
  setup() {
    return useLegalNoticeBanner()
  },
  render() {
    return null
  },
})

async function mountBanner() {
  const wrapper = await mountSuspended(BannerProbe)

  await flushPromises()

  return wrapper
}

function setNow(isoDate: string): void {
  vi.setSystemTime(new Date(isoDate))
}

describe('legal notice banner helpers', () => {
  it('names one document on its own', () => {
    expect(formatLegalDocumentList(['cookie-policy'])).toBe('Cookie Policy')
  })

  it('joins two documents with and', () => {
    expect(formatLegalDocumentList(['privacy-policy', 'terms-of-use']))
      .toBe('Privacy Policy and Terms of Use')
  })

  it('joins three documents with commas and a final and', () => {
    expect(
      formatLegalDocumentList([
        'privacy-policy',
        'terms-of-use',
        'cookie-policy',
      ]),
    ).toBe('Privacy Policy, Terms of Use and Cookie Policy')
  })

  it('points at the change history of the first document', () => {
    expect(getLegalNoticeHref(NOTICE)).toBe('/privacy-policy#change-history')
    expect(getLegalNoticeHref({
      ...NOTICE,
      documents: ['terms-of-use', 'privacy-policy'],
    })).toBe('/terms-of-use#change-history')
  })
})

describe('useLegalNoticeBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    setNow('2026-11-05T12:00:00Z')
    clearNuxtState('legal-notice:dismissed-session')
    dismissLegalNoticeMock.mockReset()
    fetchMock.mockReset()
    isSettingsLoaded.value = true
    dismissedLegalNoticeIds.value = []
    loggedIn.value = true
    user.value = { id: USER_ID }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the active notice when the account has not dismissed it',
    async () => {
      const wrapper = await mountBanner()

      expect(wrapper.vm.notice?.id).toBe(NOTICE.id)
      expect(wrapper.vm.documentsLabel).toBe('Privacy Policy and Terms of Use')
      expect(wrapper.vm.effectiveDateLabel).toBe('4 December 2026')
      expect(wrapper.vm.href).toBe('/privacy-policy#change-history')
    })

  it('stays hidden until the account settings are loaded', async () => {
    isSettingsLoaded.value = false

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()
  })

  it('stays hidden when the account already dismissed the notice',
    async () => {
      dismissedLegalNoticeIds.value = [NOTICE.id]

      const wrapper = await mountBanner()

      expect(wrapper.vm.notice).toBeNull()
    })

  it('ignores dismissed ids that belong to other notices', async () => {
    dismissedLegalNoticeIds.value = ['2026-01-another-notice']

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice?.id).toBe(NOTICE.id)
  })

  it('stays hidden for signed-out visitors', async () => {
    loggedIn.value = false

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()
  })

  it('stays hidden until the account is known', async () => {
    user.value = null

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()
  })

  it('hides at once and saves the dismissal to the account', async () => {
    const wrapper = await mountBanner()

    await wrapper.vm.dismiss()
    await flushPromises()

    expect(wrapper.vm.notice).toBeNull()
    expect(dismissLegalNoticeMock).toHaveBeenCalledTimes(1)
    expect(dismissLegalNoticeMock).toHaveBeenCalledWith(NOTICE.id)
  })

  it('stays hidden for the session and does not throw when saving the '
    + 'dismissal fails', async () => {
    dismissLegalNoticeMock.mockRejectedValue(new Error('offline'))

    const wrapper = await mountBanner()

    await expect(wrapper.vm.dismiss()).resolves.toBeUndefined()
    await flushPromises()

    expect(dismissLegalNoticeMock).toHaveBeenCalledWith(NOTICE.id)
    expect(dismissedLegalNoticeIds.value).toEqual([])
    expect(wrapper.vm.notice).toBeNull()

    const remounted = await mountBanner()

    expect(remounted.vm.notice).toBeNull()
  })

  it('keeps a session dismissal to the account that made it', async () => {
    const wrapper = await mountBanner()

    await wrapper.vm.dismiss()
    await flushPromises()

    user.value = { id: USER_ID + 1 }

    const otherAccountBanner = await mountBanner()

    expect(otherAccountBanner.vm.notice?.id).toBe(NOTICE.id)
  })

  it('does not save anything when there is no active notice', async () => {
    setNow('2026-12-18T00:00:00Z')

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()

    await wrapper.vm.dismiss()

    expect(dismissLegalNoticeMock).not.toHaveBeenCalled()
  })

  it('stays hidden before the notice is published', async () => {
    setNow('2026-10-31T05:59:59Z')

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()
  })

  it('shows from the exact publication instant', async () => {
    setNow('2026-10-31T06:00:00Z')

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice?.id).toBe(NOTICE.id)
  })

  it('shows until 14 days after the effective date', async () => {
    setNow('2026-12-17T23:59:59Z')

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice?.id).toBe(NOTICE.id)
  })

  it('hides from 14 days after the effective date', async () => {
    setNow('2026-12-18T00:00:00Z')

    const wrapper = await mountBanner()

    expect(wrapper.vm.notice).toBeNull()
  })

  it('never requests anything itself and never touches browser storage',
    async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const wrapper = await mountBanner()

      await wrapper.vm.dismiss()
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(getItem).not.toHaveBeenCalled()
      expect(setItem).not.toHaveBeenCalled()
      getItem.mockRestore()
      setItem.mockRestore()
    })
})

describe('removeLegacyLegalNoticeDismissals', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('deletes every legal notice dismissal key', () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    window.localStorage.setItem(`legal-notice:dismissed:7:${NOTICE.id}`, '1')

    removeLegacyLegalNoticeDismissals()

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps keys that are not legal notice dismissals', () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    window.localStorage.setItem('chat_input_backup', '{}')
    window.localStorage.setItem('legal-notice:other', '1')

    removeLegacyLegalNoticeDismissals()

    expect(window.localStorage.getItem('chat_input_backup')).toBe('{}')
    expect(window.localStorage.getItem('legal-notice:other')).toBe('1')
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('never reads a dismissal value and never sends anything', () => {
    window.localStorage.setItem(LEGACY_KEY, '1')

    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    removeLegacyLegalNoticeDismissals()

    expect(getItem).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dismissLegalNoticeMock).not.toHaveBeenCalled()
  })

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    window.localStorage.setItem(LEGACY_KEY, '1')

    expect(removeLegacyLegalNoticeDismissals).not.toThrow()
  })
})
