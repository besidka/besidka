import { describe, expect, it } from 'vitest'
import { sha256Hex } from '~/utils/knowledge-hash'

describe('sha256Hex', () => {
  it('returns the lowercase hex SHA-256 digest', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('abc'))

    expect(digest).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('pads leading zero bytes to a 64 character string', async () => {
    const digest = await sha256Hex(new Uint8Array(0))

    expect(digest).toHaveLength(64)
    expect(digest).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
