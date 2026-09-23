import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { GatewayProviderGroup } from '~/types/models-picker'
import GatewayProviderRail
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayProviderRail.vue'

const providers: GatewayProviderGroup[] = [
  { prefix: 'openai', count: 95 },
  { prefix: 'qwen', count: 49 },
  { prefix: 'x-ai', count: 5 },
]

function mountRail(
  props: Partial<{
    providers: GatewayProviderGroup[]
    activeProviderPrefix: string | null
    isFavoritesOnly: boolean
    hasFavorites: boolean
  }> = {},
) {
  return mountSuspended(GatewayProviderRail, {
    props: {
      providers,
      activeProviderPrefix: null,
      isFavoritesOnly: false,
      hasFavorites: false,
      ...props,
    },
  })
}

function findButtons(wrapper: Awaited<ReturnType<typeof mountRail>>) {
  return wrapper.findAll(
    '[data-testid="models-picker-gateway-provider-rail"] button',
  )
}

describe('ChatInput/ModelsTrigger/GatewayProviderRail', () => {
  it('renders one button per underlying provider', async () => {
    const wrapper = await mountRail()

    expect(findButtons(wrapper)).toHaveLength(3)
  })

  it('keeps the order the caller supplied', async () => {
    const wrapper = await mountRail()
    const prefixes = findButtons(wrapper).map((button) => {
      return button.attributes('data-testid')
    })

    expect(prefixes).toEqual([
      'models-picker-gateway-provider-openai',
      'models-picker-gateway-provider-qwen',
      'models-picker-gateway-provider-x-ai',
    ])
  })

  it('stacks the buttons vertically like the direct-provider rail',
    async () => {
      const wrapper = await mountRail()
      const rail = wrapper.get(
        '[data-testid="models-picker-gateway-provider-rail"]',
      )

      expect(rail.classes()).toContain('flex-col')
      expect(rail.classes()).toContain('border-r')
    })

  it('scrolls vertically so a long vendor list cannot grow the panel',
    async () => {
      const wrapper = await mountRail()
      const rail = wrapper.get(
        '[data-testid="models-picker-gateway-provider-rail"]',
      )

      expect(rail.classes()).toContain('overflow-y-auto')
      expect(rail.classes()).toContain('min-h-0')
      expect(rail.classes()).toContain('no-scrollbar')
    })

  it('marks only the active provider as pressed', async () => {
    const wrapper = await mountRail({ activeProviderPrefix: 'qwen' })
    const active = wrapper
      .get('[data-testid="models-picker-gateway-provider-qwen"]')
    const inactive = wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')

    expect(active.attributes('aria-pressed')).toBe('true')
    expect(active.classes()).toContain('btn-active')
    expect(active.classes()).toContain('text-accent')
    expect(inactive.attributes('aria-pressed')).toBe('false')
    expect(inactive.classes()).not.toContain('btn-active')
  })

  it('labels a provider with what picking it does', async () => {
    const wrapper = await mountRail()

    expect(wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')
      .attributes('aria-label'),
    ).toBe('Show openai models only — 95 models')
  })

  it('labels the active provider as the way back out', async () => {
    const wrapper = await mountRail({ activeProviderPrefix: 'openai' })

    expect(wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')
      .attributes('aria-label'),
    ).toBe('Stop filtering by openai')
  })

  it('says "1 model" for the one-model vendors that dominate a gateway',
    async () => {
      const wrapper = await mountRail({
        providers: [{ prefix: 'mistralai', count: 1 }],
      })
      const button = wrapper
        .get('[data-testid="models-picker-gateway-provider-mistralai"]')

      expect(button.attributes('title')).toBe('mistralai — 1 model')
      expect(button.attributes('aria-label'))
        .toBe('Show mistralai models only — 1 model')
    })

  it('names the icon-only button through a native title', async () => {
    const wrapper = await mountRail()
    const button = wrapper
      .get('[data-testid="models-picker-gateway-provider-qwen"]')

    expect(button.attributes('title')).toBe('qwen — 49 models')
    expect(button.classes()).not.toContain('tooltip')
  })

  it('emits the picked prefix', async () => {
    const wrapper = await mountRail()

    await wrapper
      .get('[data-testid="models-picker-gateway-provider-qwen"]')
      .trigger('click')

    expect(wrapper.emitted('toggleProvider')).toEqual([['qwen']])
  })

  describe('count badges', () => {
    it('hangs a daisyUI badge off each icon as an indicator item',
      async () => {
        const wrapper = await mountRail()
        const badge = wrapper.get(
          '[data-testid="models-picker-gateway-provider-openai-count"]',
        )

        expect(badge.text()).toBe('95')
        expect(badge.classes()).toContain('badge')
        expect(badge.classes()).toContain('badge-xs')
        expect(badge.classes()).toContain('indicator-item')
        expect(badge.classes()).toContain('indicator-end')
        expect(badge.classes()).toContain('indicator-bottom')
      })

    it('wraps the icon in an indicator so the badge anchors to it',
      async () => {
        const wrapper = await mountRail()
        const button = wrapper
          .get('[data-testid="models-picker-gateway-provider-openai"]')

        expect(button.get('.indicator').exists()).toBe(true)
        expect(button
          .get('.indicator')
          .find('[data-testid="models-picker-gateway-provider-openai-count"]')
          .exists(),
        ).toBe(true)
      })

    it('never dims the count the way the old strip did', async () => {
      const wrapper = await mountRail()

      expect(wrapper
        .get('[data-testid="models-picker-gateway-provider-openai-count"]')
        .classes(),
      ).not.toContain('opacity-60')
    })

    it('caps a very large catalog at three glyphs', async () => {
      const wrapper = await mountRail({
        providers: [{ prefix: 'openai', count: 412 }],
      })

      expect(wrapper
        .get('[data-testid="models-picker-gateway-provider-openai-count"]')
        .text(),
      ).toBe('99+')
    })
  })

  describe('favorites filter', () => {
    it('stays hidden until the user has a favorite', async () => {
      const wrapper = await mountRail()

      expect(
        wrapper.find('[data-testid="models-picker-rail-favorites"]').exists(),
      ).toBe(false)
    })

    it('leads the rail once a favorite exists', async () => {
      const wrapper = await mountRail({ hasFavorites: true })
      const favorites = wrapper.get(
        '[data-testid="models-picker-rail-favorites"]',
      )

      expect(favorites.attributes('aria-label'))
        .toBe('Show favorite models only')
      expect(favorites.attributes('aria-pressed')).toBe('false')
      expect(findButtons(wrapper)[0]?.attributes('data-testid'))
        .toBe('models-picker-rail-favorites')
    })

    it('marks the filter pressed while it is applied', async () => {
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

    it('emits toggleFavorites when clicked', async () => {
      const wrapper = await mountRail({ hasFavorites: true })

      await wrapper.get('[data-testid="models-picker-rail-favorites"]')
        .trigger('click')

      expect(wrapper.emitted('toggleFavorites')).toEqual([[]])
    })
  })
})
