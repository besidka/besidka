import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import FeaturePage from '../../../../../app/pages/admin/features/[flag].vue'

const mocks = vi.hoisted(() => ({
  lazyFetch: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.lazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useRoute', () => {
  return () => ({ params: { flag: 'artifacts' }, path: '/admin/features' })
})

function createFeature(overrides: Record<string, unknown> = {}) {
  return {
    key: 'artifacts',
    title: 'Artifacts',
    description: 'Interactive documents.',
    stage: 'internal',
    spend: 'none',
    optIn: 'none',
    default: false,
    allowRoles: ['admin'],
    variants: [],
    parent: null,
    killSwitched: false,
    rule: null,
    grantCounts: { allow: 0, deny: 0 },
    ...overrides,
  }
}

async function mountPage(options: {
  feature?: Record<string, unknown>
  rolloutEnabled?: boolean
} = {}) {
  mocks.lazyFetch.mockImplementation((source: unknown) => {
    const url = typeof source === 'function' ? source() : source

    if (String(url).endsWith('/grants')) {
      return {
        data: ref({ grants: [], nextOffset: null }),
        status: ref('success'),
        error: ref(null),
        refresh: vi.fn(),
      }
    }

    return {
      data: ref({
        rolloutEnabled: options.rolloutEnabled ?? false,
        hostMode: 'byok',
        flag: createFeature(options.feature),
      }),
      status: ref('success'),
      error: ref(null),
      refresh: mocks.refresh,
    }
  })

  return mountSuspended(FeaturePage)
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('admin feature page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.lazyFetch.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Turn off' })
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('keeps Save disabled until the rule changes', async () => {
    const wrapper = await mountPage()
    const save = wrapper.get('[data-testid="admin-feature-save"]')

    expect(save.element.tagName).not.toBe('BUTTON')

    await wrapper.get('[data-testid="admin-feature-role-tester"]')
      .setValue(true)
    await nextTick()

    expect(wrapper.get('[data-testid="admin-feature-save"]').element.tagName)
      .toBe('BUTTON')
  })

  it('asks for confirmation before turning a feature off', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="admin-feature-enabled"]').setValue(false)
    await wrapper.get('[data-testid="admin-feature-rule-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Turn off artifacts?',
      actions: ['Turn off'],
    }))
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/features/artifacts/rule',
      { method: 'PATCH', body: { enabled: false } },
    )
  })

  it('does not save when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="admin-feature-enabled"]').setValue(false)
    await wrapper.get('[data-testid="admin-feature-rule-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('saves a role change without a confirmation', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="admin-feature-role-tester"]')
      .setValue(true)
    await wrapper.get('[data-testid="admin-feature-rule-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/features/artifacts/rule',
      { method: 'PATCH', body: { allowRoles: ['admin', 'tester'] } },
    )
  })

  it('disables the rollout slider while rollouts are switched off', async () => {
    const wrapper = await mountPage({ rolloutEnabled: false })
    const slider = wrapper.get('[data-testid="admin-feature-rollout"]')

    expect(slider.element.closest('fieldset')?.disabled).toBe(true)
    expect(wrapper.find('[data-testid="admin-rollout-notice"]').exists())
      .toBe(true)
  })

  it('enables the rollout slider when rollouts are on', async () => {
    const wrapper = await mountPage({ rolloutEnabled: true })
    const slider = wrapper.get('[data-testid="admin-feature-rollout"]')

    expect(slider.element.closest('fieldset')?.disabled).toBe(false)
    expect(wrapper.find('[data-testid="admin-rollout-notice"]').exists())
      .toBe(false)
  })
})
