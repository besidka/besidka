import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CALLS_PER_MINUTE,
  CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
} from '#shared/utils/connectors-policy'
import { createConnectorCallLimiter } from '~~/server/utils/connectors/call-limits'
import {
  createFakeConnectorKv,
} from '../../../../setup/helpers/connectors-oauth'

describe('connector call limiter', () => {
  it('allows 30 calls a minute per connector and then refuses', async () => {
    const limit = createConnectorCallLimiter(createFakeConnectorKv() as never)

    const max = CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR

    for (let call = 0; call < max; call++) {
      expect(await limit(1, 'c1')).toBe(true)
    }

    expect(await limit(1, 'c1')).toBe(false)
    expect(await limit(1, 'c2')).toBe(true)
  })

  it('allows 60 calls a minute per user across connectors', async () => {
    const limit = createConnectorCallLimiter(createFakeConnectorKv() as never)

    for (let call = 0; call < CONNECTOR_CALLS_PER_MINUTE; call++) {
      expect(await limit(1, `c${call % 4}`)).toBe(true)
    }

    expect(await limit(1, 'c9')).toBe(false)
    expect(await limit(2, 'c9')).toBe(true)
  })

  it('fails closed when KV cannot count', async () => {
    const kv = createFakeConnectorKv()

    kv.get.mockRejectedValue(new Error('KV down'))

    expect(await createConnectorCallLimiter(kv as never)(1, 'c1')).toBe(false)
  })
})
