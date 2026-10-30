import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Vars = Record<string, unknown>

interface WranglerConfig {
  vars: Vars
  env: {
    production: {
      vars: Vars
      previews: { vars: Vars }
    }
  }
}

function parseWranglerConfig(): WranglerConfig {
  const raw = readFileSync(
    resolve(import.meta.dirname, '../../../wrangler.jsonc'),
    'utf-8',
  )

  return JSON.parse(
    raw
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n'),
  )
}

describe('wrangler.jsonc legal notice sweep vars', () => {
  const config = parseWranglerConfig()

  it('sends real mail only from the production Worker', () => {
    expect(config.env.production.vars.NUXT_LEGAL_NOTICE_SWEEP_ENABLED)
      .toBe(true)
    expect(config.vars.NUXT_LEGAL_NOTICE_SWEEP_ENABLED).toBe(false)
    expect(config.env.production.previews.vars.NUXT_LEGAL_NOTICE_SWEEP_ENABLED)
      .toBe(false)
  })

  it('keeps the slow batch, runtime and daily cap in production', () => {
    const { vars } = config.env.production

    expect(vars.NUXT_LEGAL_NOTICE_SWEEP_BATCH_SIZE).toBe(25)
    expect(vars.NUXT_LEGAL_NOTICE_SWEEP_MAX_RUNTIME_MS).toBe(60000)
    expect(vars.NUXT_LEGAL_NOTICE_DAILY_CAP).toBe(300)
  })
})
