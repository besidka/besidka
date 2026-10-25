import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayModel } from '../../../../../shared/types/gateways.d'
import type { ModelSelection } from '../../../../../shared/types/model-selection.d'
import type { MemoryIndexEstimateEntry } from '../../../../../shared/utils/memory-index-estimate'
import { estimateMemoryIndexTokens } from '../../../../../shared/utils/memory-index-estimate'
import {
  estimatePromptCacheCost,
  formatApproxTokens,
  formatCostUsd,
} from '../../../../../shared/utils/prompt-cache-estimate'
import CacheInfo from '../../../../../app/components/Profile/Memory/CacheInfo.vue'

interface FakeModel {
  id: string
  name: string
  contextLength: number
  price: {
    tokens: number
    input: string
    output: string
    cacheRead?: number
    cacheWrite?: number
  }
}

const mocks = vi.hoisted(() => ({
  selection: { value: null as unknown },
  gatewayModel: { value: null as unknown },
  name: { value: 'Model' },
  entriesData: { value: null as unknown },
  models: {} as Record<string, unknown>,
  hydrate: vi.fn(),
}))

mockNuxtImport('useSelectedModelInfo', () => () => ({
  selection: computed(() => mocks.selection.value),
  gatewayModel: computed(() => mocks.gatewayModel.value),
  name: computed(() => mocks.name.value),
}))
mockNuxtImport('useNuxtData', () => () => ({ data: mocks.entriesData }))
mockNuxtImport('hydrateGatewayCatalog', () => mocks.hydrate)
mockNuxtImport('getModel', () => (modelId: string) => {
  const entry = mocks.models[modelId] as {
    model: FakeModel
    provider: { id: string, name: string }
  } | undefined

  return entry ?? { modelName: 'Select Model', model: null, provider: null }
})

enableAutoUnmount(afterEach)

const SONNET: FakeModel = {
  id: 'claude-sonnet',
  name: 'Claude Sonnet',
  contextLength: 1_000_000,
  price: {
    tokens: 1_000_000,
    input: '$3.00',
    output: '$15.00',
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
}

const GPT: FakeModel = {
  id: 'gpt-test',
  name: 'GPT Test',
  contextLength: 400_000,
  price: {
    tokens: 1_000_000,
    input: '$1.25',
    output: '$10.00',
    cacheRead: 0.125,
  },
}

const NO_CACHE_PRICE: FakeModel = {
  id: 'plain-model',
  name: 'Plain Model',
  contextLength: 200_000,
  price: { tokens: 1_000_000, input: '$2.00', output: '$8.00' },
}

const SMALL_WINDOW: FakeModel = {
  id: 'small-model',
  name: 'Small Model',
  contextLength: 128_000,
  price: {
    tokens: 1_000_000,
    input: '$2.50',
    output: '$10.00',
    cacheRead: 0.25,
  },
}

const GATEWAY_MODEL: GatewayModel = {
  id: 'vendor/model',
  name: 'Vendor Model',
  contextLength: 200_000,
  pricing: { input: '0.000002', output: '0.00001' },
  toolCall: true,
}

function registerModel(
  model: FakeModel,
  provider: { id: string, name: string },
) {
  mocks.models[model.id] = { modelName: model.name, model, provider }
}

function selectProvider(model: FakeModel) {
  mocks.selection.value = { source: 'provider', modelId: model.id }
  mocks.name.value = model.name
}

function selectGateway(
  gatewayId: 'vercel' | 'cloudflare' | 'openrouter',
  modelId: string,
  gatewayModel: GatewayModel | null = GATEWAY_MODEL,
) {
  mocks.selection.value = {
    source: 'gateway',
    gatewayId,
    modelId,
  } satisfies ModelSelection
  mocks.gatewayModel.value = gatewayModel
  mocks.name.value = gatewayModel?.name ?? modelId
}

function stubViewport(isDesktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: isDesktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

async function mountInfo(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(CacheInfo, { props })

  await flushPromises()

  return wrapper
}

function text(
  wrapper: Awaited<ReturnType<typeof mountInfo>>,
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`).text()
}

function statusLines(wrapper: Awaited<ReturnType<typeof mountInfo>>) {
  return wrapper
    .findAll('[data-testid="memory-cache-info-status"]')
    .map(line => line.text())
}

function expectUnpricedExample(
  wrapper: Awaited<ReturnType<typeof mountInfo>>,
) {
  const example = text(wrapper, 'memory-cache-info-example')

  expect(example).toMatch(/\$[\d.,]+\. No cache price is published for this model, so the example assumes full price\.$/)
  expect(example).not.toContain('isn\'t available')
  expect(example).not.toContain('with it')
}

function memoryEntry(
  overrides: Partial<MemoryIndexEstimateEntry> = {},
): MemoryIndexEstimateEntry {
  return {
    projectId: null,
    category: 'areas',
    slug: 'likes-tea',
    title: 'Likes tea',
    description: 'Drinks green tea daily',
    body: '',
    sensitivity: 'none',
    ...overrides,
  }
}

function entriesResponse(entries: MemoryIndexEstimateEntry[]) {
  return { groups: [{ category: 'areas', entries }] }
}

describe('Profile/Memory/CacheInfo', () => {
  beforeEach(() => {
    mocks.hydrate.mockReset()
    mocks.entriesData.value = null
    mocks.gatewayModel.value = null
    mocks.models = {}
    registerModel(SONNET, { id: 'anthropic', name: 'Anthropic' })
    registerModel(GPT, { id: 'openai', name: 'OpenAI' })
    registerModel(NO_CACHE_PRICE, { id: 'deepseek', name: 'DeepSeek' })
    registerModel(SMALL_WINDOW, { id: 'google', name: 'Google' })
    selectProvider(SONNET)
    stubViewport(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('copy and structure', () => {
    it('renders an info alert with the title and the intro', async () => {
      const wrapper = await mountInfo()
      const root = wrapper.get('[data-testid="memory-cache-info"]')

      expect(root.classes()).toEqual(expect.arrayContaining([
        'alert',
        'alert-soft',
        'alert-info',
        'rounded-box',
      ]))
      expect(text(wrapper, 'memory-cache-info-toggle'))
        .toBe('Repeated context is much cheaper with prompt caching')
      expect(root.text()).toContain(
        'Memory and project knowledge are sent with every message. '
        + 'Providers cache a repeated prompt start, so the next messages '
        + 'pay a fraction of the price.',
      )
    })

    it('does not claim cached tokens are shown in usage details', async () => {
      const wrapper = await mountInfo()

      expect(wrapper.text()).not.toContain('usage details')
    })

    it('puts about before figures and drops it before a sub-cent figure', async () => {
      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-example')).toMatch(
        /cost about \$[\d.,]+ without caching and about \$[\d.,]+ with it/,
      )

      mocks.models[SONNET.id] = {
        modelName: SONNET.name,
        provider: { id: 'anthropic', name: 'Anthropic' },
        model: {
          ...SONNET,
          price: { ...SONNET.price, cacheWrite: 0.4 },
        },
      }

      const subCent = await mountInfo()

      expect(text(subCent, 'memory-cache-info-example'))
        .toMatch(/pay\s+< \$0\.01 once/)
    })

    it('names the selected chat model in the example', async () => {
      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-example'))
        .toContain('With Claude Sonnet, 20 messages with')
      expect(text(wrapper, 'memory-cache-info-example'))
        .toContain('20 messages with')
    })
  })

  describe('numbers', () => {
    it('computes the figures from the catalog prices via the estimator', async () => {
      const wrapper = await mountInfo()
      const estimate = estimatePromptCacheCost({
        tokens: 64_000,
        turns: 20,
        inputPrice: 3,
        cacheReadPrice: 0.3,
        cacheWritePrice: 3.75,
      })

      expect(text(wrapper, 'memory-cache-info-tokens')).toBe('64k')
      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(estimate.uncached))
      expect(text(wrapper, 'memory-cache-info-cached'))
        .toBe(formatCostUsd(estimate.cached))
      expect(text(wrapper, 'memory-cache-info-per-change'))
        .toBe(formatCostUsd(estimate.perChange))
    })

    it('follows the catalog when prices change', async () => {
      mocks.models[SONNET.id] = {
        modelName: SONNET.name,
        provider: { id: 'anthropic', name: 'Anthropic' },
        model: {
          ...SONNET,
          price: { ...SONNET.price, input: '$6.00' },
        },
      }

      const wrapper = await mountInfo()
      const estimate = estimatePromptCacheCost({
        tokens: 64_000,
        turns: 20,
        inputPrice: 6,
        cacheReadPrice: 0.3,
        cacheWritePrice: 3.75,
      })

      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(estimate.uncached))
    })

    it('falls back to the input price for a missing cache write price', async () => {
      selectProvider(GPT)

      const wrapper = await mountInfo()
      const estimate = estimatePromptCacheCost({
        tokens: 28_000,
        turns: 20,
        inputPrice: 1.25,
        cacheReadPrice: 0.125,
      })

      expect(text(wrapper, 'memory-cache-info-cached'))
        .toBe(formatCostUsd(estimate.cached))
      expect(text(wrapper, 'memory-cache-info-per-change'))
        .toBe(formatCostUsd(estimate.perChange))
    })

    it('caps the knowledge tokens at the model budget', async () => {
      selectProvider(SMALL_WINDOW)

      const wrapper = await mountInfo()
      const budget = Math.floor(0.07 * 128_000)
      const estimate = estimatePromptCacheCost({
        tokens: budget,
        turns: 20,
        inputPrice: 2.5,
        cacheReadPrice: 0.25,
      })

      expect(text(wrapper, 'memory-cache-info-tokens'))
        .toBe(formatApproxTokens(budget))
      expect(budget).toBeLessThan(64_000)
      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(estimate.uncached))
    })

    it('caps a huge window at 64k tokens', async () => {
      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-tokens')).toBe('64k')
    })

    it('formats a tiny amount as less than a cent', async () => {
      mocks.models[SONNET.id] = {
        modelName: SONNET.name,
        provider: { id: 'anthropic', name: 'Anthropic' },
        model: {
          ...SONNET,
          price: {
            tokens: 1_000_000,
            input: '$0.001',
            output: '$0.002',
            cacheRead: 0.0001,
            cacheWrite: 0.0012,
          },
        },
      }

      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-uncached')).toBe('< $0.01')
      expect(text(wrapper, 'memory-cache-info-per-change')).toBe('< $0.01')
    })

    it('formats a large amount with thousands separators', async () => {
      mocks.models[SONNET.id] = {
        modelName: SONNET.name,
        provider: { id: 'anthropic', name: 'Anthropic' },
        model: {
          ...SONNET,
          price: { ...SONNET.price, input: '$20,000.00' },
        },
      }

      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(20 * 64_000 * 20_000 / 1e6))
      expect(text(wrapper, 'memory-cache-info-uncached')).toContain(',')
    })

    it('shows no example when the model has no price at all', async () => {
      mocks.models[NO_CACHE_PRICE.id] = {
        modelName: NO_CACHE_PRICE.name,
        provider: { id: 'deepseek', name: 'DeepSeek' },
        model: {
          ...NO_CACHE_PRICE,
          price: { tokens: 1_000_000, input: '', output: '' },
        },
      }
      selectProvider(NO_CACHE_PRICE)

      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-example"]').exists())
        .toBe(false)
      expect(text(wrapper, 'memory-cache-info-no-example'))
        .toContain('No price is published for this model')
    })

    it('shows no example for an unknown model', async () => {
      mocks.selection.value = { source: 'provider', modelId: 'unknown' }

      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-example"]').exists())
        .toBe(false)
      expect(statusLines(wrapper)).toEqual([])
    })
  })

  describe('status line per route', () => {
    it('explains caching for direct Anthropic', async () => {
      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual([
        'Besidka turns on caching for Claude. Cached context expires after '
        + '5 minutes without a message.',
      ])
    })

    it('names the provider for a generic direct provider', async () => {
      selectProvider(GPT)

      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual([
        'OpenAI caches repeated context automatically. It is best effort: '
        + 'the provider decides.',
      ])
      expect(text(wrapper, 'memory-cache-info-example'))
        .toContain('without caching and')
      expect(text(wrapper, 'memory-cache-info-example'))
        .not.toContain('No cache price is published')
    })

    it('says the Vercel gateway is asked to cache and the example agrees', async () => {
      selectGateway('vercel', 'vendor/model')

      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual([
        'Caching is requested from the gateway (best effort).',
      ])
      expectUnpricedExample(wrapper)
      expect(wrapper.find('[data-testid="memory-cache-info-cached"]').exists())
        .toBe(false)
    })

    it('says caching is on for OpenRouter anthropic ids without contradicting itself', async () => {
      selectGateway('openrouter', 'anthropic/claude-sonnet')

      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual(['Caching is on for this model.'])
      expectUnpricedExample(wrapper)
    })

    it('says it depends on the upstream for other OpenRouter ids', async () => {
      selectGateway('openrouter', 'google/gemini')

      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual(['Depends on the upstream provider.'])
      expectUnpricedExample(wrapper)
    })

    it('puts the gateway model name with a colon in bold without extra punctuation', async () => {
      selectGateway('openrouter', 'anthropic/claude-sonnet', {
        ...GATEWAY_MODEL,
        name: 'Anthropic: Claude Sonnet 4.5',
      })

      const wrapper = await mountInfo()

      expect(wrapper.get('[data-testid="memory-cache-info-example"] strong')
        .text()).toBe('Anthropic: Claude Sonnet 4.5')
      expect(text(wrapper, 'memory-cache-info-example')).toContain(
        'With Anthropic: Claude Sonnet 4.5, 20 messages with',
      )
    })

    it('hides the cached figures for Cloudflare AI Gateway', async () => {
      selectGateway('cloudflare', 'openai/gpt')

      const wrapper = await mountInfo()
      const estimate = estimatePromptCacheCost({
        tokens: Math.floor(0.07 * 200_000),
        turns: 20,
        inputPrice: 2,
      })

      expect(statusLines(wrapper)).toEqual([
        'Caching is not available through this gateway: every message pays '
        + 'the full price.',
      ])
      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(estimate.uncached))
      expect(wrapper.find('[data-testid="memory-cache-info-cached"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="memory-cache-info-per-change"]')
        .exists()).toBe(false)
      expect(text(wrapper, 'memory-cache-info-example'))
        .toContain('caching isn\'t available for it')
      expect(text(wrapper, 'memory-cache-info-example'))
        .not.toContain('No cache price is published')
    })

    it('shows only the uncached figure for a model with no cache price', async () => {
      selectProvider(NO_CACHE_PRICE)

      const wrapper = await mountInfo()

      expect(statusLines(wrapper)).toEqual([
        'DeepSeek caches repeated context automatically. It is best effort: '
        + 'the provider decides.',
      ])
      expectUnpricedExample(wrapper)
      expect(wrapper.find('[data-testid="memory-cache-info-cached"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="memory-cache-info-per-change"]')
        .exists()).toBe(false)
    })

    it('converts gateway per-token prices to per million', async () => {
      selectGateway('vercel', 'vendor/model')

      const wrapper = await mountInfo()
      const estimate = estimatePromptCacheCost({
        tokens: Math.floor(0.07 * 200_000),
        turns: 20,
        inputPrice: 2,
      })

      expect(text(wrapper, 'memory-cache-info-uncached'))
        .toBe(formatCostUsd(estimate.uncached))
    })

    it('assumes a 128k window for a gateway model without one', async () => {
      selectGateway('vercel', 'vendor/model', {
        ...GATEWAY_MODEL,
        contextLength: undefined,
      })

      const wrapper = await mountInfo()

      expect(text(wrapper, 'memory-cache-info-tokens'))
        .toBe(formatApproxTokens(Math.floor(0.07 * 128_000)))
    })

    it('shows no example while the gateway catalog has no prices', async () => {
      selectGateway('openrouter', 'vendor/model', null)

      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-example"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="memory-cache-info-no-example"]')
        .exists()).toBe(true)
    })

    it('warms the gateway catalog for a gateway selection', async () => {
      selectGateway('openrouter', 'vendor/model', null)

      await mountInfo()

      expect(mocks.hydrate).toHaveBeenCalledWith('openrouter')
    })

    it('does not touch the gateway catalog for a direct selection', async () => {
      await mountInfo()

      expect(mocks.hydrate).not.toHaveBeenCalled()
    })
  })

  describe('memory index sentence', () => {
    it('is absent when the entries are not loaded', async () => {
      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-memory-index"]')
        .exists()).toBe(false)
    })

    it('is absent when the user has no entries', async () => {
      mocks.entriesData.value = entriesResponse([])

      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-memory-index"]')
        .exists()).toBe(false)
    })

    it('is absent when only project entries exist', async () => {
      mocks.entriesData.value = entriesResponse([
        memoryEntry({ projectId: 'project-1' }),
      ])

      const wrapper = await mountInfo()

      expect(wrapper.find('[data-testid="memory-cache-info-memory-index"]')
        .exists()).toBe(false)
    })

    it('reports the size of the account index', async () => {
      const entries = [
        memoryEntry(),
        memoryEntry({
          category: 'profile',
          slug: 'about',
          title: 'About me',
          body: 'I am a developer who lives in Lviv and likes short answers.',
        }),
        memoryEntry({ projectId: 'project-1', slug: 'project-only' }),
      ]

      mocks.entriesData.value = entriesResponse(entries)

      const wrapper = await mountInfo()
      const tokens = estimateMemoryIndexTokens(entries)

      expect(tokens).toBeGreaterThan(0)
      expect(text(wrapper, 'memory-cache-info-memory-index')).toBe(
        `Your memory index (${formatApproxTokens(tokens)} tokens) is cached `
        + 'the same way. Very short prompts can be below a provider\'s '
        + 'minimum cacheable size (Claude: 512 to 4,096 tokens depending '
        + 'on the model) and are then sent at full price.',
      )
    })
  })

  describe('collapse behaviour', () => {
    it('is open on a desktop viewport', async () => {
      stubViewport(true)

      const wrapper = await mountInfo()

      expect(wrapper.get('details').attributes('open')).toBeDefined()
    })

    it('is collapsed on a small viewport', async () => {
      stubViewport(false)

      const wrapper = await mountInfo()

      expect(wrapper.get('details').attributes('open')).toBeUndefined()
    })

    it('asks for the sm breakpoint', async () => {
      await mountInfo()

      expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 640px)')
    })

    it('toggles when the title is clicked', async () => {
      stubViewport(false)

      const wrapper = await mountInfo()
      const toggle = wrapper.get('[data-testid="memory-cache-info-toggle"]')

      await toggle.trigger('click')

      expect(wrapper.get('details').attributes('open')).toBeDefined()

      await toggle.trigger('click')

      expect(wrapper.get('details').attributes('open')).toBeUndefined()
    })

    it('keeps the title visible while collapsed', async () => {
      stubViewport(false)

      const wrapper = await mountInfo()

      expect(wrapper.get('[data-testid="memory-cache-info-toggle"]').text())
        .toBe('Repeated context is much cheaper with prompt caching')
    })
  })

  describe('project knowledge mode', () => {
    it('uses the real knowledge tokens instead of the example budget',
      async () => {
        const wrapper = await mountInfo({ knowledgeTokens: 12_500 })
        const estimate = estimatePromptCacheCost({
          tokens: 12_500,
          turns: 20,
          inputPrice: 3,
          cacheReadPrice: 0.3,
          cacheWritePrice: 3.75,
        })

        expect(text(wrapper, 'memory-cache-info-tokens'))
          .toBe(formatApproxTokens(12_500))
        expect(text(wrapper, 'memory-cache-info-uncached'))
          .toBe(formatCostUsd(estimate.uncached))
        expect(text(wrapper, 'memory-cache-info-cached'))
          .toBe(formatCostUsd(estimate.cached))
        expect(text(wrapper, 'memory-cache-info-per-change'))
          .toBe(formatCostUsd(estimate.perChange))
      })

    it.each([undefined, 0, -5])(
      'keeps the 64k-style example for knowledgeTokens %s',
      async (knowledgeTokens) => {
        const wrapper = await mountInfo({ knowledgeTokens })

        expect(text(wrapper, 'memory-cache-info-tokens')).toBe('64k')
      },
    )

    it('keeps the model budget for a small window when no tokens are given',
      async () => {
        selectProvider(SMALL_WINDOW)

        const wrapper = await mountInfo({ knowledgeTokens: undefined })

        expect(text(wrapper, 'memory-cache-info-tokens'))
          .toBe(formatApproxTokens(8960))
      })

    it('does not cap the real tokens at the example budget', async () => {
      selectProvider(SMALL_WINDOW)

      const wrapper = await mountInfo({ knowledgeTokens: 60_000 })

      expect(text(wrapper, 'memory-cache-info-tokens')).toBe('60k')
    })

    it('hides the memory index sentence when asked', async () => {
      mocks.entriesData.value = entriesResponse([memoryEntry()])

      const shown = await mountInfo()
      const hidden = await mountInfo({ showMemoryIndex: false })

      expect(shown.find('[data-testid="memory-cache-info-memory-index"]')
        .exists()).toBe(true)
      expect(hidden.find('[data-testid="memory-cache-info-memory-index"]')
        .exists()).toBe(false)
    })
  })

  describe('collapsed after the first view', () => {
    const SEEN_KEY = 'knowledge-cache-info-seen'

    beforeEach(() => {
      window.localStorage.clear()
    })

    it('is open the first time and records that it was seen', async () => {
      stubViewport(false)

      const wrapper = await mountInfo({ collapsedAfterFirstView: true })

      expect(wrapper.get('details').attributes('open')).toBeDefined()
      expect(window.localStorage.getItem(SEEN_KEY)).toBe('1')
    })

    it('is collapsed on later views, even on desktop', async () => {
      stubViewport(true)
      window.localStorage.setItem(SEEN_KEY, '1')

      const wrapper = await mountInfo({ collapsedAfterFirstView: true })

      expect(wrapper.get('details').attributes('open')).toBeUndefined()
      expect(wrapper.get('[data-testid="memory-cache-info-toggle"]').text())
        .toBe('Repeated context is much cheaper with prompt caching')
    })

    it('opens again when the title is clicked', async () => {
      window.localStorage.setItem(SEEN_KEY, '1')

      const wrapper = await mountInfo({ collapsedAfterFirstView: true })

      await wrapper.get('[data-testid="memory-cache-info-toggle"]')
        .trigger('click')

      expect(wrapper.get('details').attributes('open')).toBeDefined()
    })

    it('ignores the seen flag on /profile/memory', async () => {
      stubViewport(true)
      window.localStorage.setItem(SEEN_KEY, '1')

      const wrapper = await mountInfo()

      expect(wrapper.get('details').attributes('open')).toBeDefined()
    })

    it('still renders when storage throws', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('blocked')
        })
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('blocked')
        })

      const wrapper = await mountInfo({ collapsedAfterFirstView: true })

      expect(wrapper.get('details').attributes('open')).toBeDefined()
      expect(wrapper.get('[data-testid="memory-cache-info-example"]')
        .exists()).toBe(true)

      getItem.mockRestore()
      setItem.mockRestore()
    })
  })
})
