import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExtraChecks
  from '../../../../../app/components/Profile/Memory/ExtraChecks.vue'

const mocks = vi.hoisted(() => ({
  status: 'missing' as 'saved' | 'missing' | 'unknown',
  keyStatusForProvider: vi.fn(),
}))

mockNuxtImport('useUserKeys', () => {
  return () => ({
    keyStatusForProvider: mocks.keyStatusForProvider,
  })
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  mocks.status = 'missing'
  mocks.keyStatusForProvider.mockReset().mockImplementation(() => {
    return mocks.status
  })
})

async function mountExtraChecks() {
  const wrapper = await mountSuspended(ExtraChecks)

  await flushPromises()

  return wrapper
}

describe('Profile/Memory/ExtraChecks', () => {
  it('shows that Jev checks are on when a TypeSafe AI key is saved',
    async () => {
      mocks.status = 'saved'

      const wrapper = await mountExtraChecks()

      expect(wrapper.get('[data-testid="memory-checks-on"]').text())
        .toBe('Memory checks: TypeSafe AI Jev (on)')
      expect(wrapper.find('[data-testid="memory-checks-add-key"]').exists())
        .toBe(false)
      expect(mocks.keyStatusForProvider).toHaveBeenCalledWith('typesafe')
    })

  it('links to the TypeSafe AI card when no key is saved', async () => {
    const wrapper = await mountExtraChecks()
    const link = wrapper.get('[data-testid="memory-checks-add-key"]')

    expect(link.text()).toBe('Add a TypeSafe AI key for extra memory checks')
    expect(link.attributes('href') ?? link.attributes('to'))
      .toBe('/profile/keys?provider=typesafe')
    expect(wrapper.find('[data-testid="memory-checks-on"]').exists())
      .toBe(false)
  })

  it('shows a skeleton while the key status is unknown', async () => {
    mocks.status = 'unknown'

    const wrapper = await mountExtraChecks()

    expect(wrapper.find('[data-testid="memory-checks-skeleton"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="memory-checks-on"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="memory-checks-add-key"]').exists())
      .toBe(false)
  })
})
