import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardWithPaste } from '../../../app/composables/clipboard'

describe('useClipboardWithPaste', () => {
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    )
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }

    vi.restoreAllMocks()
  })

  it('trims a trailing newline from pasted clipboard text', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('cf-real-token\n'),
      },
    })

    const { paste } = useClipboardWithPaste()

    expect(await paste()).toBe('cf-real-token')
  })

  it('trims surrounding whitespace from pasted clipboard text', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('  account-id-123  \r\n'),
      },
    })

    const { paste } = useClipboardWithPaste()

    expect(await paste()).toBe('account-id-123')
  })

  it('returns an empty string when reading the clipboard fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    })

    const { paste } = useClipboardWithPaste()

    expect(await paste()).toBe('')
  })
})
