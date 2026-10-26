import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../../../app/pages/profile/settings.vue'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}))

mockNuxtImport('navigateTo', () => mocks.navigateTo)

describe('profile settings page', () => {
  beforeEach(() => {
    mocks.navigateTo.mockReset()
  })

  it('redirects to the preferences page', async () => {
    await mountSuspended(SettingsPage)

    expect(mocks.navigateTo).toHaveBeenCalledWith(
      '/profile/preferences',
      { redirectCode: 301 },
    )
  })
})
