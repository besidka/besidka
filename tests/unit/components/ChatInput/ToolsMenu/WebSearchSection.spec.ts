import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import {
  AUTO_WEB_SEARCH_EXPLANATION,
  AUTO_WEB_SEARCH_HINT,
  AUTO_WEB_SEARCH_PICK_PROVIDER_HINT,
} from '#shared/utils/auto-web-search'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '../../../../../app/types/web-search'
import WebSearchSection from '../../../../../app/components/ChatInput/ToolsMenu/WebSearchSection.vue'

const mocks = vi.hoisted(() => ({
  rates: {} as Record<string, string>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { ...mocks.rates },
  })
})

function nativeOption(enabled = true): WebSearchOption {
  return {
    value: 'web_search',
    label: 'Model\'s built-in search',
    enabled,
    disabledReason: enabled
      ? undefined
      : 'This model has no built-in web search.',
  }
}

function braveOption(hasKey = true): WebSearchOption {
  return hasKey
    ? {
      value: 'web_search_brave',
      label: 'Brave Search',
      providerId: 'brave',
      enabled: true,
    }
    : {
      value: 'web_search_brave',
      label: 'Add Brave Search key',
      providerId: 'brave',
      enabled: false,
      addKeyHref: '/profile/keys?tab=search',
    }
}

function exaOption(hasKey = true): WebSearchOption {
  return hasKey
    ? {
      value: 'web_search_exa',
      label: 'Exa',
      providerId: 'exa',
      enabled: true,
    }
    : {
      value: 'web_search_exa',
      label: 'Add Exa key',
      providerId: 'exa',
      enabled: false,
      addKeyHref: '/profile/keys?tab=search',
    }
}

interface SectionProps {
  selected: WebSearchSelection
  options?: WebSearchOption[]
  isToolCallingSupported?: boolean
  exaSearchLevel?: ExaSearchLevel
  isAutoAvailable?: boolean
  isAutoPreferred?: boolean
  modelId?: string
  billingProviderId?: string | null
}

async function mountSection(props: SectionProps) {
  const selectedProviders: WebSearchSelection[] = []
  const selectedLevels: ExaSearchLevel[] = []
  const autoToggles: boolean[] = []

  const Host = defineComponent({
    setup() {
      return () => h('div', h(WebSearchSection, {
        'options': [nativeOption(), braveOption(), exaOption()],
        'isToolCallingSupported': true,
        'modelId': 'gemini-3.1-pro',
        'billingProviderId': 'google',
        ...props,
        'onSelect-provider': (value: WebSearchSelection) => {
          selectedProviders.push(value)
        },
        'onSelect-exa-search-level': (level: ExaSearchLevel) => {
          selectedLevels.push(level)
        },
        'onToggle-auto': (isOn: boolean) => {
          autoToggles.push(isOn)
        },
      }))
    },
  })

  const wrapper = await mountSuspended(Host)

  return { wrapper, selectedProviders, selectedLevels, autoToggles }
}

function input(
  wrapper: Awaited<ReturnType<typeof mountSection>>['wrapper'],
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`)
    .element as HTMLInputElement
}

function depthPrices(
  wrapper: Awaited<ReturnType<typeof mountSection>>['wrapper'],
) {
  return wrapper
    .findAll('[data-testid^="exa-search-level-"]')
    .flatMap((levelInput) => {
      const price = levelInput.element.closest('label')?.querySelector('small')

      return price ? [price.textContent?.trim()] : []
    })
}

describe('ChatInput/ToolsMenu/WebSearchSection', () => {
  beforeEach(() => {
    mocks.rates = {}
  })

  it('renders Off, Built-in, Brave and Exa segments in that order, with '
    + 'full names as accessible labels', async () => {
    const { wrapper } = await mountSection({ selected: 'off' })
    const segments = wrapper.findAll('[data-testid^="web-search-option-"]')

    expect(segments.map(segment => segment.attributes('aria-label')))
      .toEqual(['Off', 'Model\'s built-in search', 'Brave Search', 'Exa'])
    expect(wrapper.findAll('label').map(label => label.text()).slice(0, 4))
      .toEqual(['Off', 'Built-in', 'Brave', 'Exa'])
  })

  describe('segment icons', () => {
    it('shows a globe for Built-in and the logos for Brave and Exa, none '
      + 'for Off', async () => {
      const { wrapper } = await mountSection({ selected: 'off' })

      expect(wrapper.find('[data-testid="icon-web-search-option-off"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="icon-web-search-option-web_search"]')
        .exists()).toBe(true)
      expect(wrapper.find(
        '[data-testid="icon-web-search-option-web_search_brave"]',
      ).exists()).toBe(true)
      expect(wrapper.find(
        '[data-testid="icon-web-search-option-web_search_exa"]',
      ).exists()).toBe(true)
    })

    it('hides the icons from assistive technology', async () => {
      const { wrapper } = await mountSection({ selected: 'off' })
      const icon = wrapper.get(
        '[data-testid="icon-web-search-option-web_search_brave"]',
      )

      expect(icon.attributes('aria-hidden')).toBe('true')
    })
  })

  describe('prices', () => {
    function segmentPrice(
      wrapper: Awaited<ReturnType<typeof mountSection>>['wrapper'],
      value: string,
    ) {
      const label = wrapper
        .get(`[data-testid="web-search-option-${value}"]`)
        .element
        .closest('label')

      return label?.querySelector('small')?.textContent?.trim()
    }

    it('shows Brave and the selected Exa depth rate on their segments',
      async () => {
        mocks.rates = {
          braveSearchCostPerThousandRequestsUsd: '5',
          exaLiteSearchCostPerThousandRequestsUsd: '2.5',
          exaSearchCostPerThousandRequestsUsd: '7',
          exaDeepSearchCostPerThousandRequestsUsd: '12',
        }

        const { wrapper } = await mountSection({
          selected: 'web_search_exa',
          exaSearchLevel: 'deep',
        })

        expect(segmentPrice(wrapper, 'web_search_brave')).toBe('$5/1k')
        expect(segmentPrice(wrapper, 'web_search_exa')).toBe('$12/1k')
      })

    it('follows the Exa depth on the Exa segment', async () => {
      mocks.rates = {
        exaLiteSearchCostPerThousandRequestsUsd: '2.5',
        exaSearchCostPerThousandRequestsUsd: '7',
      }

      const { wrapper } = await mountSection({
        selected: 'web_search_exa',
        exaSearchLevel: 'lite',
      })

      expect(segmentPrice(wrapper, 'web_search_exa')).toBe('$2.5/1k')
    })

    it('renders fractional rates such as $0.75/1k', async () => {
      mocks.rates = { braveSearchCostPerThousandRequestsUsd: '0.75' }

      const { wrapper } = await mountSection({ selected: 'off' })

      expect(segmentPrice(wrapper, 'web_search_brave')).toBe('$0.75/1k')
    })

    it.each([
      ['google', 'gemini-3.1-pro', '$14/1k'],
      ['google', 'gemini-2.5-pro', '$35/1k'],
      ['anthropic', 'claude-sonnet-5', '$10/1k'],
      ['openai', 'gpt-5.4', '$11/1k'],
      ['deepseek', 'deepseek-v4', '$0.5/1k'],
    ])('prices Built-in for %s %s', async (providerId, modelId, price) => {
      mocks.rates = {
        googleSearchCostPerThousandQueriesUsd: '14',
        googleSearchCostPerThousandGroundedPromptsUsd: '35',
        anthropicWebSearchCostPerThousandSearchesUsd: '10',
        openaiWebSearchCostPerThousandCallsUsd: '11',
        deepseekSearchCostPerThousandRequestsUsd: '0.5',
      }

      const { wrapper } = await mountSection({
        selected: 'off',
        billingProviderId: providerId,
        modelId,
      })

      expect(segmentPrice(wrapper, 'web_search')).toBe(price)
    })

    it.each([
      ['xai', 'grok-4'],
      ['openrouter', 'google/gemini-3.1-pro'],
      [null, ''],
    ])('shows no Built-in price for %s', async (providerId, modelId) => {
      mocks.rates = {
        googleSearchCostPerThousandQueriesUsd: '14',
        anthropicWebSearchCostPerThousandSearchesUsd: '10',
      }

      const { wrapper } = await mountSection({
        selected: 'off',
        billingProviderId: providerId,
        modelId,
      })

      expect(segmentPrice(wrapper, 'web_search')).toBeUndefined()
    })

    it('shows no Built-in price when the rate is not configured', async () => {
      const { wrapper } = await mountSection({ selected: 'off' })

      expect(segmentPrice(wrapper, 'web_search')).toBeUndefined()
    })

    it('shows no Built-in price when the model has no built-in search',
      async () => {
        mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

        const { wrapper } = await mountSection({
          selected: 'off',
          options: [nativeOption(false), braveOption(), exaOption()],
        })

        expect(segmentPrice(wrapper, 'web_search')).toBeUndefined()
      })
  })

  describe('Built-in hint', () => {
    const hintSelector = '[data-testid="web-search-built-in-hint"]'

    it.each(['off', 'web_search_brave', 'web_search_exa'] as const)(
      'is hidden while %s is selected',
      async (selected) => {
        const { wrapper } = await mountSection({ selected })

        expect(wrapper.find(hintSelector).exists()).toBe(false)
      },
    )

    it('names the provider and its price when Built-in is selected',
      async () => {
        mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

        const { wrapper } = await mountSection({ selected: 'web_search' })

        expect(wrapper.get(hintSelector).text()).toBe(
          'The model\'s own search from Google. Your Google key pays $14 '
          + 'per 1,000 searches.',
        )
      })

    it('counts older Gemini models per prompt', async () => {
      mocks.rates = { googleSearchCostPerThousandGroundedPromptsUsd: '35' }

      const { wrapper } = await mountSection({
        selected: 'web_search',
        modelId: 'gemini-2.5-pro',
      })

      expect(wrapper.get(hintSelector).text()).toContain(
        '$35 per 1,000 prompts.',
      )
    })

    it('drops the price sentence when no rate is known', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: 'xai',
        modelId: 'grok-4',
      })

      expect(wrapper.get(hintSelector).text()).toBe(
        'The model\'s own search from xAI, billed by xAI.',
      )
    })

    it('names the gateway for a gateway selection', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: 'openrouter',
        modelId: 'google/gemini-3.1-pro',
      })

      expect(wrapper.get(hintSelector).text()).toBe(
        'The model\'s own search from OpenRouter, billed by OpenRouter.',
      )
    })

    it('falls back to a plain line without a known provider', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: null,
      })

      expect(wrapper.get(hintSelector).text())
        .toBe('The model\'s own search.')
    })

    it('is also the hover title of the Built-in segment', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({ selected: 'off' })
      const label = wrapper
        .get('[data-testid="web-search-option-web_search"]')
        .element
        .closest('label')

      expect(label?.getAttribute('title')).toBe(
        'The model\'s own search from Google. Your Google key pays $14 '
        + 'per 1,000 searches.',
      )
    })
  })

  it('checks the selected provider', async () => {
    const { wrapper } = await mountSection({ selected: 'web_search_brave' })

    expect(input(wrapper, 'web-search-option-web_search_brave').checked)
      .toBe(true)
    expect(input(wrapper, 'web-search-option-off').checked).toBe(false)
  })

  it('emits the picked provider and nothing for the current one',
    async () => {
      const { wrapper, selectedProviders } = await mountSection({
        selected: 'off',
      })

      await wrapper.get('[data-testid="web-search-option-web_search_exa"]')
        .setValue(true)
      await wrapper.get('[data-testid="web-search-option-off"]')
        .trigger('change')

      expect(selectedProviders).toEqual(['web_search_exa'])
    })

  it('disables built-in search the model lacks, explaining why', async () => {
    const { wrapper } = await mountSection({
      selected: 'off',
      options: [nativeOption(false), braveOption(), exaOption()],
    })
    const native = wrapper.get('[data-testid="web-search-option-web_search"]')

    expect((native.element as HTMLInputElement).disabled).toBe(true)
    expect(native.attributes('aria-label'))
      .toContain('This model has no built-in web search.')
  })

  it('disables a keyless provider and adds one add-key link for it',
    async () => {
      const { wrapper } = await mountSection({
        selected: 'off',
        options: [nativeOption(), braveOption(false), exaOption()],
      })

      expect(input(wrapper, 'web-search-option-web_search_brave').disabled)
        .toBe(true)

      const link = wrapper.get('[data-testid="web-search-add-key-brave"]')

      expect(link.text()).toContain('Add a Brave key')
      expect(wrapper.find('[data-testid="web-search-add-key-exa"]').exists())
        .toBe(false)
    })

  it('removes Brave and Exa with one explanatory line when the model '
    + 'cannot call tools', async () => {
    const { wrapper } = await mountSection({
      selected: 'off',
      isToolCallingSupported: false,
      options: [nativeOption(), braveOption(false), exaOption(false)],
    })

    expect(wrapper.findAll('[data-testid^="web-search-option-"]'))
      .toHaveLength(2)
    expect(wrapper.get('[data-testid="web-search-no-tool-calling"]').text())
      .toBe('This model can\'t call tools, so Brave and Exa aren\'t '
        + 'available.')
    expect(wrapper.find('[data-testid^="web-search-add-key-"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="exa-search-level-auto"]').exists())
      .toBe(false)
  })

  describe('Exa depth', () => {
    it('stays rendered but disabled while Exa is not selected', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_brave' })

      expect(wrapper.text()).toContain('Exa depth')
      expect(wrapper.text()).toContain('Only for Exa')
      expect(input(wrapper, 'exa-search-level-lite').disabled).toBe(true)
      expect(input(wrapper, 'exa-search-level-auto').disabled).toBe(true)
      expect(input(wrapper, 'exa-search-level-deep').disabled).toBe(true)
    })

    it('is enabled with Exa selected and defaults to Auto', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_exa' })

      expect(wrapper.text()).toContain('Price per 1,000 searches')
      expect(input(wrapper, 'exa-search-level-auto').disabled).toBe(false)
      expect(input(wrapper, 'exa-search-level-auto').checked).toBe(true)
    })

    it('checks the passed level', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search_exa',
        exaSearchLevel: 'deep',
      })

      expect(input(wrapper, 'exa-search-level-deep').checked).toBe(true)
      expect(input(wrapper, 'exa-search-level-auto').checked).toBe(false)
    })

    it('shows each price as the second line of its segment', async () => {
      mocks.rates = {
        exaLiteSearchCostPerThousandRequestsUsd: '5',
        exaSearchCostPerThousandRequestsUsd: '7',
        exaDeepSearchCostPerThousandRequestsUsd: '12',
      }

      const { wrapper } = await mountSection({ selected: 'web_search_exa' })
      const prices = depthPrices(wrapper)

      expect(prices).toEqual(['$5/1k', '$7/1k', '$12/1k'])
    })

    it('hides a price whose rate is missing', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_exa' })

      expect(depthPrices(wrapper)).toEqual([])
    })

    it('emits the chosen level and not a provider change', async () => {
      const {
        wrapper,
        selectedLevels,
        selectedProviders,
      } = await mountSection({ selected: 'web_search_exa' })

      await wrapper.get('[data-testid="exa-search-level-deep"]')
        .setValue(true)

      expect(selectedLevels).toEqual(['deep'])
      expect(selectedProviders).toEqual([])
    })
  })

  describe('Auto', () => {
    it('is hidden unless Auto is available', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search' })

      expect(wrapper.find('[data-testid="web-search-auto-section"]').exists())
        .toBe(false)
    })

    it('reflects and toggles the saved preference', async () => {
      const { wrapper, autoToggles } = await mountSection({
        selected: 'web_search',
        isAutoAvailable: true,
        isAutoPreferred: false,
      })

      expect(input(wrapper, 'web-search-auto-toggle').checked).toBe(false)
      expect(wrapper.get('[data-testid="web-search-auto-hint"]').text())
        .toBe(AUTO_WEB_SEARCH_HINT)

      await wrapper.get('[data-testid="web-search-auto-toggle"]')
        .setValue(true)

      expect(autoToggles).toEqual([true])
    })

    it('is disabled with a hint to pick a provider while search is off',
      async () => {
        const { wrapper } = await mountSection({
          selected: 'off',
          isAutoAvailable: true,
          isAutoPreferred: true,
        })

        expect(input(wrapper, 'web-search-auto-toggle').disabled).toBe(true)
        expect(input(wrapper, 'web-search-auto-toggle').checked).toBe(false)
        expect(wrapper.get('[data-testid="web-search-auto-hint"]').text())
          .toBe(AUTO_WEB_SEARCH_PICK_PROVIDER_HINT)
      })

    it('reveals the explanation through a disclosure button', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search',
        isAutoAvailable: true,
      })
      const info = wrapper.get('[data-testid="web-search-auto-info"]')
      const explanation = wrapper.get(`#${info.attributes('aria-controls')}`)

      expect(info.attributes('aria-expanded')).toBe('false')
      expect(explanation.attributes('style')).toContain('display: none')

      await info.trigger('click')

      expect(info.attributes('aria-expanded')).toBe('true')
      expect(explanation.attributes('style') ?? '').not.toContain('none')
      expect(explanation.text()).toBe(AUTO_WEB_SEARCH_EXPLANATION)
      expect(
        wrapper.get('[data-testid="web-search-auto-toggle"]')
          .attributes('aria-describedby'),
      ).toContain(explanation.attributes('id'))
    })
  })
})
