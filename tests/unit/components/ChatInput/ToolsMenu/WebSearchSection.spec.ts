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
  exaRates: {} as Record<string, string>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { ...mocks.exaRates },
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

describe('ChatInput/ToolsMenu/WebSearchSection', () => {
  beforeEach(() => {
    mocks.exaRates = {}
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
      mocks.exaRates = {
        exaLiteSearchCostPerThousandRequestsUsd: '5',
        exaSearchCostPerThousandRequestsUsd: '7',
        exaDeepSearchCostPerThousandRequestsUsd: '12',
      }

      const { wrapper } = await mountSection({ selected: 'web_search_exa' })
      const prices = wrapper.findAll('small').map(small => small.text())

      expect(prices).toEqual(['$5/1k', '$7/1k', '$12/1k'])
    })

    it('hides a price whose rate is missing', async () => {
      const { wrapper } = await mountSection({ selected: 'web_search_exa' })

      expect(wrapper.findAll('small')).toHaveLength(0)
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
