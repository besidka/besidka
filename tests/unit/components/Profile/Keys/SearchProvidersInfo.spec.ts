import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SearchProvidersInfo
  from '../../../../../app/components/Profile/Keys/SearchProvidersInfo.vue'

const mocks = vi.hoisted(() => ({
  searchRates: {} as Record<string, string>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { ...mocks.searchRates },
  })
})

beforeEach(() => {
  mocks.searchRates = {}
})

describe('Profile/Keys/SearchProvidersInfo', () => {
  it('renders as an info alert with an info icon', async () => {
    const wrapper = await mountSuspended(SearchProvidersInfo)

    const alert = wrapper.get('[data-testid="search-providers-info"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.classes()).toContain('alert-info')
    expect(alert.find('.iconify').exists()).toBe(true)
  })

  it('explains why a search key helps models with no built-in search',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const text = wrapper.text()

      expect(text).toContain('without built-in web search')
      expect(text).toContain('Brave or Exa key')
      expect(text).toContain('One search provider runs per message')
    })

  it('shows a pricing subheading followed by a table, not two lists',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      expect(wrapper.text()).toContain('Pricing per 1,000 searches')
      expect(wrapper.find('.overflow-x-auto table').exists()).toBe(true)
      expect(wrapper.findAll('ul').length).toBe(0)
    })

  it('renders each rate read from runtime config in its own row', async () => {
    mocks.searchRates = {
      braveSearchCostPerThousandRequestsUsd: '5',
      exaLiteSearchCostPerThousandRequestsUsd: '4',
      exaSearchCostPerThousandRequestsUsd: '7',
      exaDeepSearchCostPerThousandRequestsUsd: '12',
      googleSearchCostPerThousandQueriesUsd: '14',
      googleSearchCostPerThousandGroundedPromptsUsd: '35',
      anthropicWebSearchCostPerThousandSearchesUsd: '10',
      openaiWebSearchCostPerThousandCallsUsd: '10',
      deepseekSearchCostPerThousandRequestsUsd: '0.75',
    }

    const wrapper = await mountSuspended(SearchProvidersInfo)

    const rows = wrapper.findAll('tbody tr')
    const names = rows.map(row => row.findAll('td')[0]?.text())
    const prices = rows.map(row => row.findAll('td')[1]?.text())

    expect(names).toEqual([
      'Brave Search',
      'Exa Lite',
      'Exa Auto (default)',
      'Exa Deep',
      'Gemini 3.x built-in',
      'Gemini 2.5 built-in',
      'Anthropic built-in',
      'OpenAI built-in',
      'DeepSeek built-in',
    ])
    expect(prices).toEqual([
      '$5',
      '$4',
      '$7',
      '$12',
      '$14',
      '$35',
      '$10',
      '$10',
      '$0.75',
    ])
  })

  it('shows a dash when a rate is unset or invalid', async () => {
    mocks.searchRates = {
      braveSearchCostPerThousandRequestsUsd: '',
      exaLiteSearchCostPerThousandRequestsUsd: '',
      exaSearchCostPerThousandRequestsUsd: '0',
      exaDeepSearchCostPerThousandRequestsUsd: 'not-a-number',
      googleSearchCostPerThousandQueriesUsd: '',
      googleSearchCostPerThousandGroundedPromptsUsd: '',
      anthropicWebSearchCostPerThousandSearchesUsd: 'not-a-number',
      openaiWebSearchCostPerThousandCallsUsd: '-5',
      deepseekSearchCostPerThousandRequestsUsd: '',
    }

    const wrapper = await mountSuspended(SearchProvidersInfo)

    const rows = wrapper.findAll('tbody tr')
    const prices = rows.map(row => row.findAll('td')[1]?.text())

    expect(prices).toEqual(Array(9).fill('—'))
  })

  it('shows the verified free-tier allowance for each search provider',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const text = wrapper.text()

      expect(text).toContain('$5 credit / month (card required)')
      expect(text).toContain('$10 credit / month (no card)')
      expect(text).toContain(
        'DeepSeek charges only for searches that return results.',
      )
      expect(text).toContain(
        'Documented: 5,000 queries / month on paid billing. In practice '
        + 'Google may bill from the first query.',
      )
      expect(text).toContain(
        '1,500 prompts / day free on paid billing (Flash: 500 / day on '
        + 'the free tier)',
      )
    })

  it('lists three Exa rows with the credit only on the first one',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const exaRows = wrapper.findAll('tbody tr').filter((row) => {
        return row.findAll('td')[0]?.text().startsWith('Exa')
      })

      expect(exaRows.map(row => row.findAll('td')[0]?.text())).toEqual([
        'Exa Lite',
        'Exa Auto (default)',
        'Exa Deep',
      ])
      expect(exaRows.map(row => row.findAll('td')[2]?.text())).toEqual([
        '$10 credit / month (no card)',
        'Same credit',
        'Same credit',
      ])
    })

  it('explains that Exa searches at Lite, Auto or Deep in the chat menu',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      expect(wrapper.text()).toContain(
        'Exa searches at Lite, Auto (default) or Deep, chosen in the '
        + 'chat\'s web search menu.',
      )
    })

  it('discloses that Gemini search is estimated at list price from the '
    + 'first query', async () => {
    const wrapper = await mountSuspended(SearchProvidersInfo)

    expect(wrapper.text()).toContain(
      'List prices as of October 2026 and may change. Besidka '
      + 'estimates Gemini search at list price from the first query, '
      + 'which has matched real Google invoices more closely than the '
      + 'documented allowance.',
    )
  })
})
