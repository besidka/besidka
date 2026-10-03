import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { gatewayIds } from '../../../shared/utils/gateways'

describe('gatewayIds', () => {
  it('is the single source of truth for every gateway id', () => {
    expect(gatewayIds).toEqual(['vercel', 'cloudflare', 'openrouter'])
  })

  it('backs a z.enum that accepts exactly these ids', () => {
    const schema = z.enum(gatewayIds)

    for (const gatewayId of gatewayIds) {
      expect(schema.safeParse(gatewayId).success).toBe(true)
    }

    expect(schema.safeParse('not-a-gateway').success).toBe(false)
    expect(schema.safeParse('').success).toBe(false)
  })
})
