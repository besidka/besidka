import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface RateLimitBinding {
  name: string
  namespace_id: string
  simple: { limit: number, period: number }
}

interface WranglerBlock {
  ratelimits?: RateLimitBinding[]
}

const WRANGLER_CONFIG_PATH = resolve(
  import.meta.dirname,
  '../../../wrangler.jsonc',
)

function parseWranglerConfig(): WranglerBlock & {
  env: Record<string, WranglerBlock & {
    previews?: WranglerBlock
  }>
} {
  const raw = readFileSync(WRANGLER_CONFIG_PATH, 'utf-8')
  const withoutComments = raw
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

  return JSON.parse(withoutComments)
}

function skillsLimiter(block: WranglerBlock | undefined) {
  return block?.ratelimits?.find((binding) => {
    return binding.name === 'SKILLS_RATE_LIMITER'
  })
}

describe('SKILLS_RATE_LIMITER binding', () => {
  const config = parseWranglerConfig()

  it('allows 10 requests per 60 seconds at the top level', () => {
    expect(skillsLimiter(config)).toMatchObject({
      simple: { limit: 10, period: 60 },
    })
  })

  it('is declared in the production environment and its previews', () => {
    const production = config.env.production!

    expect(skillsLimiter(production)).toMatchObject({
      simple: { limit: 10, period: 60 },
    })
    expect(skillsLimiter(production.previews)).toMatchObject({
      simple: { limit: 10, period: 60 },
    })
  })

  it('uses namespace ids that no other binding uses', () => {
    const production = config.env.production!
    const ids = [
      ...(config.ratelimits ?? []),
      ...(production.ratelimits ?? []),
    ].map((binding) => {
      return `${binding.name}:${binding.namespace_id}`
    })
    const namespaceIds = [
      ...(config.ratelimits ?? []),
      ...(production.ratelimits ?? []),
    ].map((binding) => {
      return binding.namespace_id
    })

    expect(ids).toHaveLength(4)
    expect(new Set(namespaceIds).size).toBe(namespaceIds.length)
  })
})
