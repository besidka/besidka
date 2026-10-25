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
) {
  return mountSuspended(GatewayModelList, {
    props: {
      gatewayId,
      filterModel,
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
})
