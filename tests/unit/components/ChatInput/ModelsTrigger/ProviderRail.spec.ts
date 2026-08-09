import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { Providers } from '#shared/types/providers.d'
import ProviderRail
  from '../../../../../app/components/ChatInput/ModelsTrigger/ProviderRail.vue'

const providers: Providers = [
  { id: 'openai', name: 'OpenAI', models: [] },
  { id: 'google', name: 'Google AI Studio', models: [] },
]

function mountRail(
  props: Partial<{
    providers: Providers
    activeProviderId: string | null
    isFavoritesOnly: boolean
    hasFavorites: boolean
    keylessProviderIds: string[]
  }> = {},
) {
  return mountSuspended(ProviderRail, {
    props: {
      providers,
      activeProviderId: null,
      isFavoritesOnly: false,
      hasFavorites: false,
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/ProviderRail', () => {
  it('renders one labelled button per provider', async () => {
    const wrapper = await mountRail()
    const openai = wrapper.get('[data-testid="models-picker-rail-openai"]')
    const google = wrapper.get('[data-testid="models-picker-rail-google"]')

    expect(openai.attributes('aria-label')).toBe('Show OpenAI models only')
    expect(openai.attributes('data-tip')).toBe('OpenAI')
    expect(openai.attributes('aria-pressed')).toBe('false')
    expect(google.attributes('aria-label'))
      .toBe('Show Google AI Studio models only')
    expect(google.attributes('data-tip')).toBe('Google AI Studio')
  })

  it('hides the favorites filter until the user has a favorite', async () => {
    const wrapper = await mountRail()

    expect(
      wrapper.find('[data-testid="models-picker-rail-favorites"]').exists(),
    ).toBe(false)
    expect(wrapper.find('.divider').exists()).toBe(false)
  })

  it('shows the favorites filter once a favorite exists', async () => {
    const wrapper = await mountRail({ hasFavorites: true })
    const favorites = wrapper.get(
      '[data-testid="models-picker-rail-favorites"]',
    )

    expect(favorites.attributes('aria-label'))
      .toBe('Show favorite models only')
    expect(favorites.attributes('data-tip')).toBe('Favorites')
    expect(favorites.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.divider').exists()).toBe(true)
  })

  it('marks the favorites filter pressed while it is applied', async () => {
    const wrapper = await mountRail({
      hasFavorites: true,
      isFavoritesOnly: true,
    })
    const favorites = wrapper.get(
      '[data-testid="models-picker-rail-favorites"]',
    )

    expect(favorites.attributes('aria-pressed')).toBe('true')
    expect(favorites.classes()).toContain('btn-active')
    expect(favorites.classes()).toContain('text-warning')
  })

  it('emits toggleFavorites when the favorites filter is clicked', async () => {
    const wrapper = await mountRail({ hasFavorites: true })

    await wrapper.get('[data-testid="models-picker-rail-favorites"]')
      .trigger('click')

    expect(wrapper.emitted('toggleFavorites')).toEqual([[]])
  })

  it('emits toggleProvider with the clicked provider id', async () => {
    const wrapper = await mountRail()

    await wrapper.get('[data-testid="models-picker-rail-google"]')
      .trigger('click')

    expect(wrapper.emitted('toggleProvider')).toEqual([['google']])
  })

  it('marks only the active provider as pressed', async () => {
    const wrapper = await mountRail({ activeProviderId: 'openai' })
    const openai = wrapper.get('[data-testid="models-picker-rail-openai"]')
    const google = wrapper.get('[data-testid="models-picker-rail-google"]')

    expect(openai.attributes('aria-pressed')).toBe('true')
    expect(openai.classes()).toContain('btn-active')
    expect(openai.classes()).toContain('text-accent')
    expect(google.attributes('aria-pressed')).toBe('false')
    expect(google.classes()).not.toContain('btn-active')
  })

  it('renders brand marks for the known providers', async () => {
    const wrapper = await mountRail({
      providers: [
        ...providers,
        { id: 'anthropic', name: 'Anthropic', models: [] },
      ],
    })

    const expectedIconNames: Record<string, string> = {
      openai: 'simple-icons:openai',
      google: 'simple-icons:googlegemini',
      anthropic: 'simple-icons:anthropic',
    }

    for (const [providerId, iconName] of Object.entries(expectedIconNames)) {
      const button = wrapper.get(
        `[data-testid="models-picker-rail-${providerId}"]`,
      )

      expect(button.findComponent({ name: 'NuxtIcon' }).props('name'))
        .toBe(iconName)
    }
  })

  it('falls back to the first two letters of an unknown provider', async () => {
    const wrapper = await mountRail({
      providers: [{ id: 'nousresearch', name: 'Nous Research', models: [] }],
    })
    const unknown = wrapper.get(
      '[data-testid="models-picker-rail-nousresearch"]',
    )

    expect(unknown.text()).toBe('No')
    expect(unknown.get('span').classes()).toContain('uppercase')
    expect(unknown.findComponent({ name: 'NuxtIcon' }).exists()).toBe(false)
  })

  describe('keyless providers', () => {
    it('marks only the providers it is told have no key', async () => {
      const wrapper = await mountRail({ keylessProviderIds: ['openai'] })

      expect(
        wrapper.find('[data-testid="models-picker-rail-openai-keyless"]')
          .exists(),
      ).toBe(true)
      expect(
        wrapper.find('[data-testid="models-picker-rail-google-keyless"]')
          .exists(),
      ).toBe(false)
    })

    it('says why in the tooltip and the accessible name', async () => {
      const wrapper = await mountRail({ keylessProviderIds: ['openai'] })
      const openai = wrapper.get('[data-testid="models-picker-rail-openai"]')

      expect(openai.attributes('data-tip'))
        .toBe('OpenAI — API key required')
      expect(openai.attributes('aria-label'))
        .toBe('Show OpenAI models only — API key required')
    })

    it('keeps the button usable so filtering still explains the state', async () => {
      const wrapper = await mountRail({ keylessProviderIds: ['openai'] })

      await wrapper.get('[data-testid="models-picker-rail-openai"]')
        .trigger('click')

      expect(wrapper.emitted('toggleProvider')).toEqual([['openai']])
    })

    it('marks nothing when the prop is omitted, which is the fail-open default', async () => {
      const wrapper = await mountRail()

      expect(
        wrapper.find('[data-testid="models-picker-rail-openai-keyless"]')
          .exists(),
      ).toBe(false)
      expect(
        wrapper.get('[data-testid="models-picker-rail-openai"]')
          .attributes('data-tip'),
      ).toBe('OpenAI')
    })
  })
})
