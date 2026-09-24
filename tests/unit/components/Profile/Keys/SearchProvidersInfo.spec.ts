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

      expect(text).toContain('no built-in web search')
      expect(text).toContain('any tool-calling model can search the web')
      expect(text).toContain('One search provider runs per message')
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

      expect(text).toContain(`Brave ≈ $${braveRate} / 1,000`)
      expect(text).toContain(`Exa ≈ $${exaRate} / 1,000`)
      expect(text).toContain(`Anthropic ≈ $${anthropicRate} / 1,000`)
      expect(text).toContain(`OpenAI ≈ $${openaiRate} / 1,000`)
      expect(text).toContain(`Google ≈ $${googleQueryRate} / 1,000`)
      expect(text).toContain(`$${googleGroundedRate} / 1,000`)
    })

  it('discloses that prices are published list prices billed by the '
    + 'search provider', async () => {
    const wrapper = await mountSuspended(SearchProvidersInfo)

    const text = wrapper.text()

    expect(text).toContain('Published list prices, may change')
    expect(text).toContain('you pay the search provider directly')
  })
})
