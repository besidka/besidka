import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WRANGLER_CONFIG_PATH = resolve(
  import.meta.dirname,
  '../../../wrangler.jsonc',
)

const SEARCH_COST_RATE_KEY_PATTERN = /_COST_PER_THOUSAND_.*_USD$/

/**
 * `wrangler.jsonc`'s comment discipline in this repo is full-line only —
 * every `//` comment starts at the beginning of its (trimmed) line, and the
 * only other `//` occurrences are inside `https://`/`http://` string values.
 * Dropping every line whose trimmed form starts with `//`, and leaving every
 * other line untouched, is therefore a safe way to reach valid JSON without
 * pulling in a JSONC parser dependency this repo does not otherwise need.
 * This assumption is real and load-bearing: a future trailing inline
 * comment on the same line as a value would silently corrupt this parse.
 */
function stripFullLineComments(jsonc: string): string {
  return jsonc
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

function parseWranglerConfig(): Record<string, unknown> {
  const raw = readFileSync(WRANGLER_CONFIG_PATH, 'utf-8')

  return JSON.parse(stripFullLineComments(raw))
}

function extractSearchCostRates(
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const rates: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(vars)) {
    if (SEARCH_COST_RATE_KEY_PATTERN.test(key)) {
      rates[key] = value
    }
  }

  return rates
}

describe('wrangler.jsonc search-cost rates', () => {
  it('agree between the top-level (preview) and production vars blocks',
    () => {
      const config = parseWranglerConfig()
      const previewVars = config.vars as Record<string, unknown>
      const env = config.env as Record<
        string,
        { vars: Record<string, unknown> }
      >
      const productionVars = env.production.vars

      const previewRates = extractSearchCostRates(previewVars)
      const productionRates = extractSearchCostRates(productionVars)

      expect(Object.keys(previewRates).length).toBeGreaterThan(0)
      expect(productionRates).toEqual(previewRates)
    })

  it('includes the Brave and Exa external-search rates alongside the '
    + 'four pre-existing native rates', () => {
    const config = parseWranglerConfig()
    const previewVars = config.vars as Record<string, unknown>
    const rates = extractSearchCostRates(previewVars)

    expect(rates).toMatchObject({
      NUXT_PUBLIC_GOOGLE_SEARCH_COST_PER_THOUSAND_QUERIES_USD:
        expect.any(String),
      NUXT_PUBLIC_GOOGLE_SEARCH_COST_PER_THOUSAND_GROUNDED_PROMPTS_USD:
        expect.any(String),
      NUXT_PUBLIC_ANTHROPIC_WEB_SEARCH_COST_PER_THOUSAND_SEARCHES_USD:
        expect.any(String),
      NUXT_PUBLIC_OPENAI_WEB_SEARCH_COST_PER_THOUSAND_CALLS_USD:
        expect.any(String),
      NUXT_PUBLIC_BRAVE_SEARCH_COST_PER_THOUSAND_REQUESTS_USD:
        expect.any(String),
      NUXT_PUBLIC_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD:
        expect.any(String),
    })
  })
})
