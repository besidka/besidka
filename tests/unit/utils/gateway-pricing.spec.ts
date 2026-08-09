import { describe, expect, it } from 'vitest'
import {
  isGatewayModelFree,
  resolveGatewayPriceTier,
} from '#shared/utils/gateway-pricing'

describe('resolveGatewayPriceTier', () => {
  it('returns null when pricing is missing', () => {
    expect(resolveGatewayPriceTier({})).toBeNull()
  })

  it('returns null when the input price is an empty string', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '', output: '0.00001' },
    })).toBeNull()
  })

  it('returns null when the input price is unparseable', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: 'abc', output: '0.00001' },
    })).toBeNull()
  })

  it('returns null for a negative sentinel price', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '-1', output: '-1' },
    })).toBeNull()
  })

  it('resolves the cheapest tier for a low per-token price', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '0.0000001', output: '0.0000002' },
    })).toBe('$')
  })

  it('resolves the cheapest tier exactly at its ceiling', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '0.0000005', output: '0.000001' },
    })).toBe('$')
  })

  it('resolves the second tier just above the cheapest ceiling', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '0.0000006', output: '0.000001' },
    })).toBe('$$')
  })

  it('resolves the third tier exactly at its ceiling', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '0.000005', output: '0.00001' },
    })).toBe('$$$')
  })

  it('resolves the highest tier above every ceiling', () => {
    expect(resolveGatewayPriceTier({
      pricing: { input: '0.00001', output: '0.00002' },
    })).toBe('$$$+')
  })
})

describe('isGatewayModelFree', () => {
  it('is false when pricing is missing', () => {
    expect(isGatewayModelFree({})).toBe(false)
  })

  it('is true when both input and output prices are zero', () => {
    expect(isGatewayModelFree({
      pricing: { input: '0', output: '0' },
    })).toBe(true)
  })

  it('is true for a zero price written with decimal zeros', () => {
    expect(isGatewayModelFree({
      pricing: { input: '0.00', output: '0.0' },
    })).toBe(true)
  })

  it('is false when only the input price is zero', () => {
    expect(isGatewayModelFree({
      pricing: { input: '0', output: '0.00001' },
    })).toBe(false)
  })

  it('is false when only the output price is zero', () => {
    expect(isGatewayModelFree({
      pricing: { input: '0.00001', output: '0' },
    })).toBe(false)
  })

  it('is false when a price is a negative sentinel', () => {
    expect(isGatewayModelFree({
      pricing: { input: '-1', output: '-1' },
    })).toBe(false)
  })

  it('is false when a price is unparseable', () => {
    expect(isGatewayModelFree({
      pricing: { input: 'abc', output: '0' },
    })).toBe(false)
  })
})
