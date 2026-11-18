import { describe, expect, it } from 'vitest'
import {
  connectorHeaderAuthSchema,
  readConnectorHeaderCredential,
} from '~~/server/utils/connectors/header-auth'

describe('readConnectorHeaderCredential', () => {
  it('returns null when the request carries no key', () => {
    expect(readConnectorHeaderCredential({})).toBeNull()
  })

  it('builds Authorization: Bearer from a token', () => {
    expect(readConnectorHeaderCredential({
      auth: { kind: 'bearer', token: 'exa_key' },
    })).toEqual({ name: 'Authorization', value: 'Bearer exa_key' })
  })

  it('does not double a pasted Bearer prefix', () => {
    expect(readConnectorHeaderCredential({
      auth: { kind: 'bearer', token: 'bearer exa_key' },
    })).toEqual({ name: 'Authorization', value: 'Bearer exa_key' })
  })

  it('sends a custom header untouched', () => {
    expect(readConnectorHeaderCredential({
      auth: { kind: 'header', name: 'x-api-key', value: 'raw' },
    })).toEqual({ name: 'x-api-key', value: 'raw' })
  })

  it('still accepts the older header pair', () => {
    expect(readConnectorHeaderCredential({
      header: { name: 'Authorization', value: 'Bearer ghp_secret' },
    })).toEqual({ name: 'Authorization', value: 'Bearer ghp_secret' })
  })

  it('applies the header rules to a custom header', () => {
    expect(() => readConnectorHeaderCredential({
      auth: { kind: 'header', name: 'Cookie', value: 'a=b' },
    })).toThrow()
    expect(() => readConnectorHeaderCredential({
      auth: { kind: 'header', name: 'bad name', value: 'a' },
    })).toThrow()
    expect(() => readConnectorHeaderCredential({
      auth: { kind: 'header', name: 'x-api-key', value: 'a\nb' },
    })).toThrow()
  })

  it('refuses a token that is only the prefix', () => {
    expect(() => readConnectorHeaderCredential({
      auth: { kind: 'bearer', token: 'Bearer ' },
    })).toThrow()
  })

  it('refuses both shapes in one request', () => {
    expect(() => readConnectorHeaderCredential({
      auth: { kind: 'bearer', token: 'a' },
      header: { name: 'x-api-key', value: 'b' },
    })).toThrow()
  })
})

describe('connectorHeaderAuthSchema', () => {
  it('accepts both kinds and rejects an unknown one', () => {
    expect(connectorHeaderAuthSchema.safeParse({
      kind: 'bearer',
      token: 'a',
    }).success).toBe(true)
    expect(connectorHeaderAuthSchema.safeParse({
      kind: 'header',
      name: 'x-api-key',
      value: 'a',
    }).success).toBe(true)
    expect(connectorHeaderAuthSchema.safeParse({
      kind: 'basic',
      token: 'a',
    }).success).toBe(false)
  })
})
