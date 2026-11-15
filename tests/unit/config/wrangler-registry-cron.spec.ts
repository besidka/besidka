import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGISTRY_SYNC_CRON } from '#shared/utils/connectors-policy'

interface WranglerConfig {
  triggers: { crons: string[] }
  env: { production: { triggers: { crons: string[] } } }
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

describe('wrangler.jsonc registry sync cron', () => {
  const config = parseWranglerConfig()

  it('gives the registry sync its own trigger, apart from the hourly sweeps', () => {
    expect(REGISTRY_SYNC_CRON).not.toBe('0 * * * *')
    expect(config.triggers.crons).toContain(REGISTRY_SYNC_CRON)
    expect(config.env.production.triggers.crons).toContain(REGISTRY_SYNC_CRON)
  })

  it('keeps the existing triggers in production', () => {
    for (const cron of ['0 * * * *', '*/5 * * * *', '* * * * *']) {
      expect(config.env.production.triggers.crons).toContain(cron)
      expect(config.triggers.crons).toContain(cron)
    }
  })
})
