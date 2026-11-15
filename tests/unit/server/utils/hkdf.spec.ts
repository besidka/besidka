import { describe, expect, it } from 'vitest'
import { bytesToHex, deriveHkdfBytes } from '~~/server/utils/hkdf'
import { createConnectorArgsHasher } from '~~/server/utils/connectors/audit'
import { canonicalJson } from '~~/server/utils/connectors/tool-definitions'
import { CONNECTOR_AUDIT_ARGS_HKDF_INFO } from '#shared/utils/connectors-policy'

describe('deriveHkdfBytes', () => {
  it('is deterministic for one secret and info', async () => {
    const first = await deriveHkdfBytes('secret', 'purpose/v1')
    const second = await deriveHkdfBytes('secret', 'purpose/v1')

    expect(first).toEqual(second)
    expect(first).toHaveLength(32)
  })

  it('gives unrelated keys for different info strings', async () => {
    const first = await deriveHkdfBytes('secret', 'purpose/a')
    const second = await deriveHkdfBytes('secret', 'purpose/b')

    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('gives different keys for different secrets', async () => {
    const first = await deriveHkdfBytes('secret-one', 'purpose/v1')
    const second = await deriveHkdfBytes('secret-two', 'purpose/v1')

    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('honors the requested length', async () => {
    expect(await deriveHkdfBytes('secret', 'purpose/v1', 16)).toHaveLength(16)
  })

  it('matches the key the audit digest was derived with before the '
    + 'extraction', async () => {
    const args = { query: 'short', limit: 2 }
    const encoder = new TextEncoder()
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('audit-secret'),
      'HKDF',
      false,
      ['deriveKey'],
    )
    const legacyKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: encoder.encode(CONNECTOR_AUDIT_ARGS_HKDF_INFO),
      },
      baseKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    )
    const legacyDigest = bytesToHex(new Uint8Array(await crypto.subtle.sign(
      'HMAC',
      legacyKey,
      encoder.encode(canonicalJson(args)),
    )))

    expect(await createConnectorArgsHasher('audit-secret')(args))
      .toBe(legacyDigest)
  })
})

describe('bytesToHex', () => {
  it('pads every byte to two digits', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff')
  })
})
