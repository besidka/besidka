import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import GatewayModelList
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayModelList.vue'

const mocks = vi.hoisted(() => ({
  useGatewayCatalog: vi.fn(),
}))

mockNuxtImport('useGatewayCatalog', () => mocks.useGatewayCatalog)

const model: GatewayModel = {
  id: 'openai/gpt-5',
  name: 'GPT-5',
}

function mountList(
  gatewayId: GatewayId,
  filterModel?: (model: GatewayModel) => boolean,
  extraProps: Partial<{
    recommendedDirectModels: Array<{ providerId: string, modelId: string }>
    recommendedOnly: boolean
  }> = {},
) {
  return mountSuspended(GatewayModelList, {
    props: {
      gatewayId,
      filterModel,
      ...extraProps,
      gatewayLabel: gatewayId === 'cloudflare'
        ? 'Cloudflare AI Gateway'
        : 'Vercel AI Gateway',
      searchTerm: '',
      isFavoritesOnly: false,
      isFreeOnly: false,
      isVisionOnly: false,
      capabilityFilters: [],
      activeProviderPrefix: null,
      favoriteModelIds: [],
      selectedModelId: null,
      detailModelId: null,
      listboxId: 'gateway-model-listbox',
    },
    global: {
      stubs: {
        ChatInputModelsTriggerGatewayModelItem: true,
        ChatInputModelsTriggerGatewayModelDetail: true,
      },
    },
  })
}

describe('ChatInput/ModelsTrigger/GatewayModelList', () => {
  beforeEach(() => {
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef([model]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: vi.fn(),
    })
  })

  it('shows the Workers AI catalog note for Cloudflare', async () => {
    const wrapper = await mountList('cloudflare')
    const note = wrapper.find(
      '[data-testid="gateway-cloudflare-catalog-note"]',
    )

    expect(note.exists()).toBe(true)
    expect(note.text())
      .toBe('Cloudflare AI Gateway lists Workers AI models only.')
  })

  it('does not show the note for other gateways', async () => {
    const wrapper = await mountList('vercel')

    expect(wrapper.find(
      '[data-testid="gateway-cloudflare-catalog-note"]',
    ).exists()).toBe(false)
  })

  it('hides models the caller filter rejects from every group', async () => {
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef<GatewayModel[]>([
        model,
        { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
      ]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: vi.fn(),
    })

    const wrapper = await mountList('vercel', (entry) => {
      return entry.id !== 'openai/gpt-5'
    })
    const items = wrapper.findAllComponents({
      name: 'ChatInputModelsTriggerGatewayModelItem',
    })
    const groups = wrapper.emitted('providerGroupsChange')?.at(-1)?.[0] as
      Array<{ prefix: string }>

    expect(items).toHaveLength(1)
    expect(items[0]?.props('model')).toMatchObject({
      id: 'anthropic/claude-opus-5',
    })
    expect(groups.map((group) => {
      return group.prefix
    })).toEqual(['anthropic'])
  })

  describe('recommended models', () => {
    const catalog: GatewayModel[] = [
      { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
      { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
      { id: 'openai/gpt-6-luna-mini', name: 'GPT-6 Luna Mini' },
      { id: 'moonshotai/kimi-k2.6:free', name: 'Kimi K2.6 (free)' },
    ]
    const recommendedDirectModels = [
      { providerId: 'anthropic', modelId: 'claude-haiku-5-5' },
      { providerId: 'openai', modelId: 'gpt-6-luna' },
      { providerId: 'moonshotai', modelId: 'kimi-k2.6' },
    ]

    function getItems(wrapper: Awaited<ReturnType<typeof mountList>>) {
      return wrapper.findAllComponents({
        name: 'ChatInputModelsTriggerGatewayModelItem',
      })
    }

    beforeEach(() => {
      mocks.useGatewayCatalog.mockReturnValue({
        models: shallowRef<GatewayModel[]>(catalog),
        pending: shallowRef(false),
        error: shallowRef(null),
        refresh: vi.fn(),
      })
    })

    it('flags only the models mapped to a recommended direct model', async () => {
      const wrapper = await mountList('openrouter', undefined, {
        recommendedDirectModels,
      })
      const recommendedIds = getItems(wrapper)
        .filter((item) => {
          return item.props('isRecommended')
        })
        .map((item) => {
          return item.props('model').id
        })

      expect(getItems(wrapper)).toHaveLength(5)
      expect(recommendedIds.sort()).toEqual([
        'anthropic/claude-haiku-5.5',
        'moonshotai/kimi-k2.6:free',
        'openai/gpt-6-luna',
      ])
    })

    it('flags nothing and lists everything by default', async () => {
      const wrapper = await mountList('openrouter')

      expect(getItems(wrapper)).toHaveLength(5)
      expect(getItems(wrapper).some((item) => {
        return item.props('isRecommended')
      })).toBe(false)
    })

    it('narrows the list to the recommended models and their groups', async () => {
      const wrapper = await mountList('openrouter', undefined, {
        recommendedDirectModels,
        recommendedOnly: true,
      })
      const groups = wrapper.emitted('providerGroupsChange')?.at(-1)?.[0] as
        Array<{ prefix: string, count: number }>

      expect(getItems(wrapper).map((item) => {
        return item.props('model').id
      }).sort()).toEqual([
        'anthropic/claude-haiku-5.5',
        'moonshotai/kimi-k2.6:free',
        'openai/gpt-6-luna',
      ])
      expect(groups.map((group) => {
        return [group.prefix, group.count]
      }).sort()).toEqual([
        ['anthropic', 1],
        ['moonshotai', 1],
        ['openai', 1],
      ])
    })

    it('keeps the caller filter ahead of the recommended filter', async () => {
      const wrapper = await mountList(
        'openrouter',
        (entry) => {
          return !entry.id.startsWith('openai/')
        },
        { recommendedDirectModels, recommendedOnly: true },
      )

      expect(getItems(wrapper).map((item) => {
        return item.props('model').id
      }).sort()).toEqual([
        'anthropic/claude-haiku-5.5',
        'moonshotai/kimi-k2.6:free',
      ])
    })

    it('offers to clear filters when recommended leaves no model', async () => {
      const wrapper = await mountList('openrouter', undefined, {
        recommendedDirectModels: [],
        recommendedOnly: true,
      })

      expect(getItems(wrapper)).toHaveLength(0)
      expect(wrapper.get('[data-testid="gateway-models-empty"]').text())
        .toContain('No models match the selected filters.')
      expect(wrapper.find('[data-testid="gateway-models-clear-filters"]')
        .exists()).toBe(true)
    })
  })
})
