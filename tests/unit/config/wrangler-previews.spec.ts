import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WRANGLER_CONFIG_PATH = resolve(
  import.meta.dirname,
  '../../../wrangler.jsonc',
)

type BindingKey
  = | 'd1_databases'
    | 'kv_namespaces'
    | 'r2_buckets'
    | 'analytics_engine_datasets'
    | 'ratelimits'

type BindingBlock = Record<BindingKey, Array<Record<string, unknown>>>

type Vars = Record<string, unknown>

interface WranglerConfig extends BindingBlock {
  vars: Vars
  env: {
    production: BindingBlock & {
      vars: Vars
      previews: BindingBlock & {
        vars: Vars
      }
    }
  }
}

function stripFullLineComments(jsonc: string): string {
  return jsonc
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

function parseWranglerConfig(): WranglerConfig {
  const raw = readFileSync(WRANGLER_CONFIG_PATH, 'utf-8')

  return JSON.parse(stripFullLineComments(raw))
}

function pickFields(
  entries: Array<Record<string, unknown>>,
  fields: string[],
): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    return Object.fromEntries(
      fields.map(field => [field, entry[field]]),
    )
  })
}

describe('wrangler.jsonc previews block', () => {
  const config = parseWranglerConfig()
  const production = config.env.production
  const previews = production.previews

  it('uses the same D1 databases as the top-level preview resources',
    () => {
      const fields = ['binding', 'database_name', 'database_id']

      expect(pickFields(previews.d1_databases, fields))
        .toEqual(pickFields(config.d1_databases, fields))
    })

  it('uses the same KV namespaces as the top-level preview resources',
    () => {
      expect(previews.kv_namespaces).toEqual(config.kv_namespaces)
    })

  it('uses the same R2 buckets as the top-level preview resources', () => {
    expect(previews.r2_buckets).toEqual(config.r2_buckets)
  })

  it('uses the same analytics datasets as the top-level preview resources',
    () => {
      expect(previews.analytics_engine_datasets)
        .toEqual(config.analytics_engine_datasets)
    })

  it('uses the same rate limit namespaces as the top-level preview resources',
    () => {
      const fields = ['name', 'namespace_id']

      expect(pickFields(previews.ratelimits, fields))
        .toEqual(pickFields(config.ratelimits, fields))
    })

  it('keeps previews vars in parity with top-level vars except overrides',
    () => {
      const previewOnlyKeys = ['NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS']
      const overriddenKeys = [
        'NUXT_PUBLIC_BASE_URL',
        'NUXT_PUBLIC_TURNSTILE_SITE_KEY',
        'NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN',
      ]
      const excludedKeys = [...previewOnlyKeys, ...overriddenKeys]

      function withoutKeys(vars: Vars): Vars {
        return Object.fromEntries(
          Object.entries(vars).filter(([key]) => {
            return !excludedKeys.includes(key)
          }),
        )
      }

      expect(withoutKeys(previews.vars)).toEqual(withoutKeys(config.vars))
      expect(previews.vars.NUXT_PUBLIC_BASE_URL)
        .toBe('https://preview-besidka.chernenko.workers.dev')
      expect(previews.vars.NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS)
        .toBeTypeOf('string')
      expect(config.vars.NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS).toBeUndefined()
    })

  it('uses preview-specific public keys instead of production ones', () => {
    const publicKeys = ['NUXT_PUBLIC_VAPID_PUBLIC_KEY']

    for (const key of publicKeys) {
      expect(typeof previews.vars[key]).toBe('string')
      expect(previews.vars[key]).not.toBe(production.vars[key])
    }
  })

  it('uses the dedicated preview Turnstile widget sitekey', () => {
    const turnstileSiteKey = 'NUXT_PUBLIC_TURNSTILE_SITE_KEY'
    const previewWidgetSiteKey = '0x4AAAAAAEFM-2wD0PMvdy4q'

    expect(typeof production.vars[turnstileSiteKey]).toBe('string')
    expect(previews.vars[turnstileSiteKey])
      .not.toBe(production.vars[turnstileSiteKey])
    expect(previews.vars[turnstileSiteKey])
      .not.toBe(config.vars[turnstileSiteKey])
    expect(previews.vars[turnstileSiteKey]).toBe(previewWidgetSiteKey)
  })

  it('keeps the Cloudflare Web Analytics beacon off outside production',
    () => {
      const analyticsToken = 'NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN'

      expect(production.vars[analyticsToken]).toMatch(/^[0-9a-f]{32}$/)
      expect(config.vars[analyticsToken]).toBe('')
      expect(previews.vars[analyticsToken]).toBe('')
    })

  it('never references a production resource id or name', () => {
    const serializedPreviews = JSON.stringify(previews)
    const productionIdentifiers = [
      ...production.d1_databases.flatMap((database) => {
        return [database.database_id, database.database_name]
      }),
      ...production.kv_namespaces.map(namespace => namespace.id),
      ...production.r2_buckets.map(bucket => bucket.bucket_name),
      ...production.analytics_engine_datasets.map(dataset => dataset.dataset),
      ...production.ratelimits.map(limiter => limiter.namespace_id),
    ]

    expect(productionIdentifiers.length).toBeGreaterThan(0)

    for (const identifier of productionIdentifiers) {
      expect(typeof identifier).toBe('string')
      expect(serializedPreviews).not.toContain(`"${identifier}"`)
    }
  })
})
