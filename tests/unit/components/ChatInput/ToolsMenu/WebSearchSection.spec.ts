import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import {
  AUTO_WEB_SEARCH_EXPLANATION,
  AUTO_WEB_SEARCH_HINT,
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

function isRevealed(
  wrapper: Awaited<ReturnType<typeof mountSection>>['wrapper'],
  testId: string,
): boolean {
  const element = wrapper.find(`[data-testid="${testId}"]`)

  return element.exists() && !element.element.closest('[inert]')
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

  describe('provider segments', () => {
    it('carry no price line, whatever the rates are', async () => {
      mocks.rates = {
        braveSearchCostPerThousandRequestsUsd: '5',
        exaSearchCostPerThousandRequestsUsd: '7',
        googleSearchCostPerThousandQueriesUsd: '14',
      }

      const { wrapper } = await mountSection({ selected: 'web_search_exa' })

      for (const value of ['off', 'web_search', 'web_search_brave',
        'web_search_exa']) {
        const label = wrapper
          .get(`[data-testid="web-search-option-${value}"]`)
          .element
          .closest('label')

        expect(label?.querySelector('small')).toBeNull()
      }
    })

    function segmentTitle(
      wrapper: Awaited<ReturnType<typeof mountSection>>['wrapper'],
      value: string,
    ) {
      return wrapper
        .get(`[data-testid="web-search-option-${value}"]`)
        .element
        .closest('label')
        ?.getAttribute('title')
    }

    it('use the plain full name as the hover title, with no tooltip',
      async () => {
        mocks.rates = {
          braveSearchCostPerThousandRequestsUsd: '5',
          googleSearchCostPerThousandQueriesUsd: '14',
        }

        const { wrapper } = await mountSection({ selected: 'off' })

        expect(segmentTitle(wrapper, 'web_search'))
          .toBe('Model\'s built-in search')
        expect(segmentTitle(wrapper, 'web_search_brave'))
          .toBe('Brave Search')
        expect(segmentTitle(wrapper, 'web_search_exa')).toBe('Exa')
      })

    it('keep the plain title for a keyless provider', async () => {
      const { wrapper } = await mountSection({
        selected: 'off',
        options: [nativeOption(), braveOption(false), exaOption(false)],
      })

      expect(segmentTitle(wrapper, 'web_search_brave')).toBe('Brave Search')
      expect(segmentTitle(wrapper, 'web_search_exa')).toBe('Exa')
    })
  })

  describe('price badge and note', () => {
    const badgeSelector = '[data-testid="web-search-price-badge"]'
    const noteSelector = '[data-testid="web-search-price-note"]'

    type Mounted = Awaited<ReturnType<typeof mountSection>>['wrapper']

    function mountDirect(props: SectionProps) {
      return mountSuspended(WebSearchSection, {
        props: {
          options: [nativeOption(), braveOption(), exaOption()],
          isToolCallingSupported: true,
          modelId: 'gemini-3.1-pro',
          billingProviderId: 'google',
          ...props,
        },
      })
    }

    function badgeText(wrapper: Mounted) {
      return wrapper.get(badgeSelector).text()
    }

    async function noteText(wrapper: Mounted) {
      await wrapper.get(badgeSelector).trigger('click')

      return wrapper.get(noteSelector).text()
    }

    it('has no caption element any more', async () => {
      const { wrapper } = await mountSection({ selected: 'off' })

      expect(wrapper.find('[data-testid="web-search-caption"]').exists())
        .toBe(false)
    })

    it('titles the section with a search icon', async () => {
      const { wrapper } = await mountSection({ selected: 'off' })
      const heading = wrapper.get('h3')

      expect(heading.text()).toBe('Web search')
      expect(heading.find('[data-testid="tools-section-icon"]').exists())
        .toBe(true)
    })

    it('renders neither the badge nor the note while search is off',
      async () => {
        const { wrapper } = await mountSection({ selected: 'off' })

        expect(wrapper.find(badgeSelector).exists()).toBe(false)
        expect(wrapper.find(noteSelector).exists()).toBe(false)
      })

    it('renders the badge as a collapsed disclosure button', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({ selected: 'web_search' })
      const badge = wrapper.get(badgeSelector)

      expect(badge.element.tagName).toBe('BUTTON')
      expect(badge.attributes('type')).toBe('button')
      expect(badge.classes()).toEqual(expect.arrayContaining([
        'badge',
        'badge-sm',
        'badge-soft',
        'badge-info',
      ]))
      expect(badge.attributes('aria-expanded')).toBe('false')
      expect(wrapper.get(noteSelector).attributes('style'))
        .toContain('display: none')
    })

    it('toggles the note through the badge', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({ selected: 'web_search' })
      const badge = wrapper.get(badgeSelector)
      const note = wrapper.get(noteSelector)

      expect(badge.attributes('aria-controls')).toBe(note.attributes('id'))

      await badge.trigger('click')

      expect(badge.attributes('aria-expanded')).toBe('true')
      expect(note.attributes('style') ?? '').not.toContain('none')

      await badge.trigger('click')

      expect(badge.attributes('aria-expanded')).toBe('false')
      expect(note.attributes('style')).toContain('display: none')
    })

    it('shares the info note style with the Auto explanation', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({
        selected: 'web_search',
        isAutoAvailable: true,
      })

      for (const selector of [
        noteSelector,
        '[data-testid="web-search-auto-explanation"]',
      ]) {
        expect(wrapper.get(selector).classes()).toEqual(
          expect.arrayContaining([
            'rounded-box',
            'bg-base-200',
            'text-xs',
            'px-2',
            'py-1.5',
            'mb-2',
          ]),
        )
      }
      expect(wrapper.get('[data-testid="web-search-auto-explanation"]')
        .classes()).toContain('mt-1')
    })

    it('keeps the open state and updates the text across providers',
      async () => {
        mocks.rates = {
          braveSearchCostPerThousandRequestsUsd: '5',
          googleSearchCostPerThousandQueriesUsd: '14',
        }

        const wrapper = await mountDirect({ selected: 'web_search' })

        await wrapper.get(badgeSelector).trigger('click')
        await wrapper.setProps({ selected: 'web_search_brave' })

        expect(wrapper.get(badgeSelector).attributes('aria-expanded'))
          .toBe('true')
        expect(badgeText(wrapper)).toBe('$5 / 1k searches')
        expect(wrapper.get(noteSelector).text()).toBe(
          'Brave Search on your Brave key. $5 per 1,000 searches.',
        )
      })

    it('hides the badge and the note again when switching to Off',
      async () => {
        const wrapper = await mountDirect({ selected: 'web_search_brave' })

        await wrapper.get(badgeSelector).trigger('click')
        await wrapper.setProps({ selected: 'off' })

        expect(wrapper.find(badgeSelector).exists()).toBe(false)
        expect(wrapper.find(noteSelector).exists()).toBe(false)
      })

    it('shows the rate and unit when Built-in is selected', async () => {
      mocks.rates = { googleSearchCostPerThousandQueriesUsd: '14' }

      const { wrapper } = await mountSection({ selected: 'web_search' })

      expect(badgeText(wrapper)).toBe('$14 / 1k searches')
      expect(await noteText(wrapper)).toBe(
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

      expect(badgeText(wrapper)).toBe('$35 / 1k prompts')
      expect(await noteText(wrapper)).toContain('$35 per 1,000 prompts.')
    })

    it.each([
      ['google', 'gemini-3.1-pro', '$14 / 1k searches'],
      ['anthropic', 'claude-sonnet-5', '$10 / 1k searches'],
      ['openai', 'gpt-5.4', '$11 / 1k searches'],
      ['deepseek', 'deepseek-v4', '$0.5 / 1k searches'],
    ])('prices Built-in for %s %s', async (providerId, modelId, price) => {
      mocks.rates = {
        googleSearchCostPerThousandQueriesUsd: '14',
        anthropicWebSearchCostPerThousandSearchesUsd: '10',
        openaiWebSearchCostPerThousandCallsUsd: '11',
        deepseekSearchCostPerThousandRequestsUsd: '0.5',
      }

      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: providerId,
        modelId,
      })

      expect(badgeText(wrapper)).toBe(price)
    })

    it('names the billing provider when no rate is known', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: 'xai',
        modelId: 'grok-4',
      })

      expect(badgeText(wrapper)).toBe('Billed by xAI')
      expect(await noteText(wrapper)).toBe(
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

      expect(badgeText(wrapper)).toBe('Billed by OpenRouter')
      expect(await noteText(wrapper)).toBe(
        'The model\'s own search from OpenRouter, billed by OpenRouter.',
      )
    })

    it('falls back to a plain badge without a known provider', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search',
        billingProviderId: null,
      })

      expect(badgeText(wrapper)).toBe('Model\'s own search')
      expect(await noteText(wrapper)).toBe('The model\'s own search.')
    })

    it('prices Brave', async () => {
      mocks.rates = { braveSearchCostPerThousandRequestsUsd: '5' }

      const { wrapper } = await mountSection({
        selected: 'web_search_brave',
      })

      expect(badgeText(wrapper)).toBe('$5 / 1k searches')
      expect(await noteText(wrapper)).toBe(
        'Brave Search on your Brave key. $5 per 1,000 searches.',
      )
    })

    it('renders fractional Brave rates', async () => {
      mocks.rates = { braveSearchCostPerThousandRequestsUsd: '0.75' }

      const { wrapper } = await mountSection({
        selected: 'web_search_brave',
      })

      expect(badgeText(wrapper)).toBe('$0.75 / 1k searches')
    })

    it('falls back to Price info when no Brave rate is configured',
      async () => {
        const { wrapper } = await mountSection({
          selected: 'web_search_brave',
        })

        expect(badgeText(wrapper)).toBe('Price info')
        expect(await noteText(wrapper))
          .toBe('Brave Search on your Brave key.')
      })

    it.each([
      ['lite', 'Lite', '$2.5'],
      ['auto', 'Auto', '$7'],
      ['deep', 'Deep', '$12'],
    ] as const)('follows the %s Exa depth', async (level, label, price) => {
      mocks.rates = {
        exaLiteSearchCostPerThousandRequestsUsd: '2.5',
        exaSearchCostPerThousandRequestsUsd: '7',
        exaDeepSearchCostPerThousandRequestsUsd: '12',
      }

      const { wrapper } = await mountSection({
        selected: 'web_search_exa',
        exaSearchLevel: level,
      })

      expect(badgeText(wrapper)).toBe(`${price} / 1k searches`)
      expect(await noteText(wrapper)).toBe(
        `Exa on your Exa key, ${label} depth. ${price} per 1,000 searches.`,
      )
    })

    it('falls back to Price info when the depth has no rate', async () => {
      const { wrapper } = await mountSection({
        selected: 'web_search_exa',
      })

      expect(badgeText(wrapper)).toBe('Price info')
      expect(await noteText(wrapper))
        .toBe('Exa on your Exa key, Auto depth.')
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
    it('is collapsed and inert while another provider is selected or '
      + 'search is off', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_brave' })
      const reveal = wrapper.get('[data-testid="web-search-exa-depth-reveal"]')

      expect(reveal.attributes('data-open')).toBe('false')
      expect(reveal.attributes('inert')).toBeDefined()
      expect(isRevealed(wrapper, 'exa-search-level-auto')).toBe(false)

      const searchOff = await mountSection({ selected: 'off' })

      expect(isRevealed(searchOff.wrapper, 'exa-search-level-auto'))
        .toBe(false)
    })

    it('is not rendered at all when Exa is not offered', async () => {
      const { wrapper } = await mountSection({
        selected: 'off',
        isToolCallingSupported: false,
      })

      expect(wrapper.find('[data-testid="web-search-exa-depth-reveal"]')
        .exists()).toBe(false)
    })

    it('opens once Exa is selected', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_exa' })

      expect(wrapper.get('[data-testid="web-search-exa-depth-reveal"]')
        .attributes('data-open')).toBe('true')
      expect(wrapper.text()).toContain('Exa depth')
      expect(wrapper.findAll('[data-testid^="exa-search-level-"]'))
        .toHaveLength(3)
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

    it('is collapsed and inert while search is off even when Auto is '
      + 'available', async () => {
      const { wrapper } = await mountSection({
        selected: 'off',
        isAutoAvailable: true,
        isAutoPreferred: true,
      })
      const reveal = wrapper.get('[data-testid="web-search-auto-reveal"]')

      expect(reveal.attributes('data-open')).toBe('false')
      expect(reveal.attributes('inert')).toBeDefined()
      expect(isRevealed(wrapper, 'web-search-auto-toggle')).toBe(false)
    })

    it('is shown for every selected provider when Auto is available',
      async () => {
        const { wrapper } = await mountSection({
          selected: 'web_search_exa',
          isAutoAvailable: true,
          isAutoPreferred: true,
        })

        expect(input(wrapper, 'web-search-auto-toggle').disabled).toBe(false)
        expect(input(wrapper, 'web-search-auto-toggle').checked).toBe(true)
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
