import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SearchProvidersInfo
  from '../../../../../app/components/Profile/Keys/SearchProvidersInfo.vue'

const WRANGLER_CONFIG_PATH = resolve(
  import.meta.dirname,
  '../../../../../wrangler.jsonc',
)

function stripFullLineComments(jsonc: string): string {
  return jsonc
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

function readWranglerRate(envVarName: string) {
  const raw = readFileSync(WRANGLER_CONFIG_PATH, 'utf-8')
  const config = JSON.parse(stripFullLineComments(raw))
  const rate = config.vars[envVarName]

  if (typeof rate !== 'string') {
    throw new Error(`${envVarName} not found in wrangler.jsonc`)
  }

  return rate
}

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

  it('shows pricing that matches the rates configured in wrangler.jsonc',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const text = wrapper.text()
      const braveRate = readWranglerRate(
        'NUXT_BRAVE_SEARCH_COST_PER_THOUSAND_REQUESTS_USD',
      )
      const exaRate = readWranglerRate(
        'NUXT_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD',
      )
      const anthropicRate = readWranglerRate(
        'NUXT_ANTHROPIC_WEB_SEARCH_COST_PER_THOUSAND_SEARCHES_USD',
      )
      const openaiRate = readWranglerRate(
        'NUXT_OPENAI_WEB_SEARCH_COST_PER_THOUSAND_CALLS_USD',
      )
      const googleQueryRate = readWranglerRate(
        'NUXT_GOOGLE_SEARCH_COST_PER_THOUSAND_QUERIES_USD',
      )
      const googleGroundedRate = readWranglerRate(
        'NUXT_GOOGLE_SEARCH_COST_PER_THOUSAND_GROUNDED_PROMPTS_USD',
      )

      expect(text).toContain('Brave Search')
      expect(text).toContain(`$${braveRate}`)
      expect(text).toContain('Exa')
      expect(text).toContain(`$${exaRate}`)
      expect(text).toContain('Anthropic built-in')
      expect(text).toContain(`$${anthropicRate}`)
      expect(text).toContain('OpenAI built-in')
      expect(text).toContain(`$${openaiRate}`)
      expect(text).toContain('Gemini 3.x built-in')
      expect(text).toContain(`$${googleQueryRate}`)
      expect(text).toContain('Gemini 2.5 built-in')
      expect(text).toContain(`$${googleGroundedRate}`)
    })

  it('shows the verified free-tier allowance for each search provider',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const text = wrapper.text()

      expect(text).toContain('$5 credit / month (card required)')
      expect(text).toContain('$10 credit / month (no card)')
      expect(text).toContain('5,000 / month (billing required)')
      expect(text).toContain(
        '1,500 / day with billing (Flash: 500 / day without)',
      )
    })

  it('discloses that prices are published list prices that may change',
    async () => {
      const wrapper = await mountSuspended(SearchProvidersInfo)

      const text = wrapper.text()

      expect(text).toContain(
        'List prices as of September 2026 and may change.',
      )
    })
})
