import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KeysPage from '../../../../app/pages/profile/keys.vue'

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{ id: string, models: [] }>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { providers: mocks.providers },
  })
})

function stubs() {
  return {
    ProfileKeysProviderKeyCard: {
      props: {
        providerId: { type: String, default: '' },
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
      },
      template:
        '<div data-testid="provider-card" :data-provider="providerId"'
        + ' :data-group="group" :data-open="String(open)" />',
    },
  }
}

function mountPage() {
  return mountSuspended(KeysPage, { global: { stubs: stubs() } })
}

function tabButtons(wrapper: any) {
  return wrapper.findAll('nav button')
}

function visiblePanels(wrapper: any) {
  return wrapper.findAll('[role="tabpanel"]').filter((panel: any) => {
    return panel.attributes('style') !== 'display: none;'
  })
}

describe('profile keys page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.providers = [
      { id: 'anthropic', models: [] },
      { id: 'google', models: [] },
      { id: 'openai', models: [] },
      { id: 'xai', models: [] },
      { id: 'deepseek', models: [] },
      { id: 'moonshotai', models: [] },
    ]
  })

  it('renders a single per-provider tab', async () => {
    const wrapper = await mountPage()

    const tabIds = tabButtons(wrapper).map((button: any) => {
      return button.attributes('data-testid')
    })

    expect(tabIds).toEqual(['key-tab-providers'])
  })

  it('labels the tab for assistive tech even while icon-only', async () => {
    const wrapper = await mountPage()

    const labels = tabButtons(wrapper).map((button: any) => {
      return button.attributes('aria-label')
    })

    expect(labels).toEqual(['Per provider'])
  })

  it('marks the single tab as current', async () => {
    const wrapper = await mountPage()

    const current = tabButtons(wrapper).filter((button: any) => {
      return button.attributes('aria-current') === 'true'
    })

    expect(current).toHaveLength(1)
    expect(current[0].attributes('data-testid')).toBe('key-tab-providers')
    expect(current[0].classes()).toContain('tab-active')
  })

  it('shows the per-provider panel', async () => {
    const wrapper = await mountPage()

    expect(visiblePanels(wrapper)).toHaveLength(1)
    expect(visiblePanels(wrapper)[0].attributes('data-testid'))
      .toBe('key-panel-providers')
  })

  it('lists every configured provider in catalog order', async () => {
    const wrapper = await mountPage()

    const providerIds = wrapper
      .get('[data-testid="key-panel-providers"]')
      .findAll('[data-testid="provider-card"]')
      .map((card: any) => {
        return card.attributes('data-provider')
      })

    expect(providerIds).toEqual([
      'anthropic',
      'google',
      'openai',
      'xai',
      'deepseek',
      'moonshotai',
    ])
  })

  it('skips a configured provider with no key metadata', async () => {
    mocks.providers = [
      { id: 'anthropic', models: [] },
      { id: 'not-a-provider', models: [] },
    ]

    const wrapper = await mountPage()

    const providerIds = wrapper
      .findAll('[data-testid="provider-card"]')
      .map((card: any) => {
        return card.attributes('data-provider')
      })

    expect(providerIds).toContain('anthropic')
    expect(providerIds).not.toContain('not-a-provider')
  })

  it('collapses provider cards into one shared accordion group', async () => {
    const wrapper = await mountPage()

    const cards = wrapper
      .get('[data-testid="key-panel-providers"]')
      .findAll('[data-testid="provider-card"]')

    cards.forEach((card: any) => {
      expect(card.attributes('data-group')).toBe('profile-provider-keys')
      expect(card.attributes('data-open')).toBe('false')
    })
  })
})
