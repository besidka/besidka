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

  it('links to the TypeSafe AI checks settings when a key is saved',
    async () => {
      mocks.status = 'saved'

      const wrapper = await mountExtraChecks()
      const link = wrapper.get('[data-testid="memory-checks-settings-link"]')

      expect(link.text()).toBe('Choose which TypeSafe AI checks run')
      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/profile/keys?tab=memory-checks')
    })

  it('shows memory checks as off when the user switched the role off',
    async () => {
      mocks.status = 'saved'

      const wrapper = await mountSuspended(ExtraChecks, {
        props: { typesafeRoles: { memoryChecks: false } },
      })

      await flushPromises()

      expect(wrapper.get('[data-testid="memory-checks-on"]').text())
        .toBe('Memory checks: TypeSafe AI Jev (off)')
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

  it('keeps the skeleton as tall as the saved two-line state', async () => {
    mocks.status = 'unknown'

    const skeleton = (await mountExtraChecks())
      .get('[data-testid="memory-checks-skeleton"]')
    const lines = skeleton.findAll('.skeleton')

    expect(skeleton.classes()).toContain('grid')
    expect(skeleton.classes()).toContain('gap-1')
    expect(lines).toHaveLength(2)

    for (const line of lines) {
      expect(line.classes()).toContain('h-5')
    }
  })

  it('renders the saved state as the same two text-sm lines the skeleton '
    + 'stands in for', async () => {
    mocks.status = 'saved'

    const saved = (await mountExtraChecks())
      .get('[data-testid="memory-checks-on"]').element.parentElement!

    expect(saved.classList.contains('grid')).toBe(true)
    expect(saved.classList.contains('gap-1')).toBe(true)
    expect(saved.classList.contains('text-sm')).toBe(true)
    expect(saved.children).toHaveLength(2)
  })

  it.each(['saved', 'missing', 'unknown'] as const)(
    'reserves the two-line height in the %s state',
    async (status) => {
      mocks.status = status

      const wrapper = await mountExtraChecks()

      expect(wrapper.get('[data-testid="memory-checks-content"]').classes())
        .toContain('min-h-11')
    },
  )
})
