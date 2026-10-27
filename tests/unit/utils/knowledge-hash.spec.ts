import { describe, expect, it } from 'vitest'
import { sha256Hex } from '#shared/utils/knowledge-hash'

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

  it('hashes text as its UTF-8 bytes, Cyrillic included', async () => {
    const text = 'Привіт, світе! Це нотатка про проєкт.'
    const fromText = await sha256Hex(text)
    const fromBytes = await sha256Hex(new TextEncoder().encode(text))

    expect(fromText).toBe(fromBytes)
    expect(fromText).toMatch(/^[a-f0-9]{64}$/)
  })

  it('hashes a File read in the browser like the same text', async () => {
    const text = 'Кава\ncafe\u0301 ☕\n'
    const file = new File([text], 'сніданок.md', { type: 'text/markdown' })

    expect(await sha256Hex(await file.arrayBuffer()))
      .toBe(await sha256Hex(text))
  })

  it('does not normalise the content, so NFC and NFD texts differ', async () => {
    const composed = 'caf\u00E9'
    const decomposed = 'cafe\u0301'

    expect(await sha256Hex(composed)).not.toBe(await sha256Hex(decomposed))
  })
})
