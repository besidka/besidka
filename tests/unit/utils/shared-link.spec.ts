import { describe, expect, it } from 'vitest'
import { extractSharedChatPath } from '../../../shared/utils/shared-link'

describe('extractSharedChatPath', () => {
  it('extracts the path from a full production URL', () => {
    const text = 'https://www.besidka.com/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0'

    expect(extractSharedChatPath(text)).toBe(
      '/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0',
    )
  })

  it('extracts the path from surrounding message text', () => {
    const text = 'Check this out: '
      + 'https://besidka.com/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0 (cool chat)'

    expect(extractSharedChatPath(text)).toBe(
      '/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0',
    )
  })

  it('accepts a bare path without a host', () => {
    expect(extractSharedChatPath('/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0')).toBe(
      '/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0',
    )
  })

  it('returns null for text without a shared link', () => {
    expect(extractSharedChatPath('hello world')).toBeNull()
    expect(extractSharedChatPath('https://besidka.com/chats/abc')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(extractSharedChatPath('')).toBeNull()
  })

  it('ignores too-short slugs', () => {
    expect(extractSharedChatPath('https://x.com/shared/abc')).toBeNull()
  })

  it('normalizes a lowercased slug to the stored uppercase form', () => {
    const text = 'https://besidka.com/shared/01arz3ndektsv4rrffq69g5fb0'

    expect(extractSharedChatPath(text)).toBe(
      '/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0',
    )
  })

  it('rejects slugs embedded in a longer alphanumeric run', () => {
    const text = '/shared/01ARZ3NDEKTSV4RRFFQ69G5FB0XY'

    expect(extractSharedChatPath(text)).toBeNull()
  })

  it('rejects slugs with non-Crockford characters', () => {
    expect(
      extractSharedChatPath('/shared/OILU3NDEKTSV4RRFFQ69G5FB00'),
    ).toBeNull()
  })
})
