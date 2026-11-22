import { describe, expect, it } from 'vitest'
import {
  resolveConnectorHeaderCredential,
  resolveHeaderAuthDefault,
  stripBearerPrefix,
} from '#shared/utils/connectors-auth'

describe('stripBearerPrefix', () => {
  it('leaves a raw token alone', () => {
    expect(stripBearerPrefix('abc123')).toBe('abc123')
  })

  it('removes a pasted Bearer prefix in any letter case', () => {
    expect(stripBearerPrefix('Bearer abc123')).toBe('abc123')
    expect(stripBearerPrefix('bearer abc123')).toBe('abc123')
    expect(stripBearerPrefix('BEARER   abc123')).toBe('abc123')
  })

  it('removes a doubled prefix and the surrounding spaces', () => {
    expect(stripBearerPrefix('  Bearer Bearer abc123  ')).toBe('abc123')
  })

  it('keeps a token that merely starts with the letters', () => {
    expect(stripBearerPrefix('bearertoken')).toBe('bearertoken')
  })
})

describe('resolveConnectorHeaderCredential', () => {
  it('adds the Bearer scheme once for a token', () => {
    expect(resolveConnectorHeaderCredential({
      kind: 'bearer',
      token: 'exa_key',
    })).toEqual({ name: 'Authorization', value: 'Bearer exa_key' })
  })

  it('does not double a pasted Bearer prefix', () => {
    expect(resolveConnectorHeaderCredential({
      kind: 'bearer',
      token: 'Bearer exa_key',
    })).toEqual({ name: 'Authorization', value: 'Bearer exa_key' })
  })

  it('refuses a token that is only the prefix', () => {
    expect(resolveConnectorHeaderCredential({
      kind: 'bearer',
      token: 'Bearer ',
    })).toBeNull()
  })

  it('sends a custom header exactly as typed', () => {
    expect(resolveConnectorHeaderCredential({
      kind: 'header',
      name: ' x-api-key ',
      value: 'raw value',
    })).toEqual({ name: 'x-api-key', value: 'raw value' })
    expect(resolveConnectorHeaderCredential({
      kind: 'header',
      name: 'Authorization',
      value: 'abc',
    })).toEqual({ name: 'Authorization', value: 'abc' })
  })
})

describe('resolveHeaderAuthDefault', () => {
  it('defaults to a token when no header is declared', () => {
    expect(resolveHeaderAuthDefault([])).toEqual({
      kind: 'bearer',
      name: 'Authorization',
    })
  })

  it('defaults to a token when Authorization is declared', () => {
    expect(resolveHeaderAuthDefault(['x-api-key', 'authorization'])).toEqual({
      kind: 'bearer',
      name: 'Authorization',
    })
  })

  it('opens the custom header with the declared name', () => {
    expect(resolveHeaderAuthDefault(['x-api-key'])).toEqual({
      kind: 'header',
      name: 'x-api-key',
    })
  })
})
