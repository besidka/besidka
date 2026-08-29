import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { Model, Providers } from '#shared/types/providers.d'
import ProviderRail
  from '../../../../../app/components/ChatInput/ModelsTrigger/ProviderRail.vue'

function buildModels(count: number, status?: Model['status']): Model[] {
  return Array.from({ length: count }, (_entry, index) => {
    return { id: `model-${index}`, name: `Model ${index}`, status } as Model
  })
}

const providers: Providers = [
  { id: 'openai', name: 'OpenAI', models: buildModels(3) },
  { id: 'google', name: 'Google AI Studio', models: buildModels(2) },
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

    expect(openai.attributes('aria-label'))
      .toBe('Show OpenAI models only — 3 models')
    expect(openai.attributes('data-tip')).toBe('OpenAI — 3 models')
    expect(openai.attributes('aria-pressed')).toBe('false')
    expect(google.attributes('aria-label'))
      .toBe('Show Google AI Studio models only — 2 models')
    expect(google.attributes('data-tip')).toBe('Google AI Studio — 2 models')
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
        { id: 'anthropic', name: 'Anthropic', models: buildModels(1) },
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
    expect(unknown.get('.indicator span').classes()).toContain('uppercase')
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
      ).toBe('OpenAI — 3 models')
    })

    it('shows an accent dot instead of a count, never a zero', async () => {
      const wrapper = await mountRail({ keylessProviderIds: ['openai'] })
      const dot = wrapper.get(
        '[data-testid="models-picker-rail-openai-keyless"]',
      )

      expect(dot.classes()).toContain('bg-accent')
      expect(dot.classes()).toContain('indicator-item')
      expect(dot.classes()).toContain('indicator-end')
      expect(dot.classes()).toContain('indicator-bottom')
      expect(dot.text()).toBe('')
      expect(
        wrapper.find('[data-testid="models-picker-rail-openai-count"]')
          .exists(),
      ).toBe(false)
    })

    it('leaves the icon at full opacity now the dot carries the signal',
      async () => {
        const wrapper = await mountRail({ keylessProviderIds: ['openai'] })
        const icon = wrapper
          .get('[data-testid="models-picker-rail-openai"]')
          .findComponent({ name: 'ProviderIcon' })

        expect(icon.classes()).not.toContain('opacity-40')
        expect(icon.classes()).not.toContain('opacity-60')
      })
  })

  describe('count badges', () => {
    it('hangs a daisyUI badge off each keyed provider icon', async () => {
      const wrapper = await mountRail()
      const badge = wrapper.get(
        '[data-testid="models-picker-rail-openai-count"]',
      )

      expect(badge.text()).toBe('3')
      expect(badge.classes()).toContain('badge')
      expect(badge.classes()).toContain('badge-xs')
      expect(badge.classes()).toContain('indicator-item')
      expect(badge.classes()).toContain('indicator-end')
      expect(badge.classes()).toContain('indicator-bottom')
    })

    it('wraps the icon in an indicator so the badge anchors to it',
      async () => {
        const wrapper = await mountRail()
        const button = wrapper.get('[data-testid="models-picker-rail-openai"]')

        expect(button.find('.indicator').exists()).toBe(true)
        expect(button
          .get('.indicator')
          .find('[data-testid="models-picker-rail-openai-count"]')
          .exists(),
        ).toBe(true)
      })

    it('says "1 model" when a provider carries exactly one', async () => {
      const wrapper = await mountRail({
        providers: [{ id: 'openai', name: 'OpenAI', models: buildModels(1) }],
      })
      const openai = wrapper.get('[data-testid="models-picker-rail-openai"]')

      expect(openai.attributes('data-tip')).toBe('OpenAI — 1 model')
      expect(openai.attributes('aria-label'))
        .toBe('Show OpenAI models only — 1 model')
    })

    it('counts only the models the picker will list', async () => {
      const wrapper = await mountRail({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: [...buildModels(2), ...buildModels(3, 'deprecated')],
          },
        ],
      })

      expect(wrapper
        .get('[data-testid="models-picker-rail-openai-count"]')
        .text(),
      ).toBe('2')
    })

    it('shows no badge at all when a keyed provider lists nothing',
      async () => {
        const wrapper = await mountRail({
          providers: [{ id: 'openai', name: 'OpenAI', models: [] }],
        })

        expect(
          wrapper.find('[data-testid="models-picker-rail-openai-count"]')
            .exists(),
        ).toBe(false)
        expect(
          wrapper.get('[data-testid="models-picker-rail-openai"]')
            .attributes('data-tip'),
        ).toBe('OpenAI')
      })

    it('caps a very large catalog at three glyphs', async () => {
      const wrapper = await mountRail({
        providers: [
          { id: 'openai', name: 'OpenAI', models: buildModels(140) },
        ],
      })

      expect(wrapper
        .get('[data-testid="models-picker-rail-openai-count"]')
        .text(),
      ).toBe('99+')
    })
  })
})
