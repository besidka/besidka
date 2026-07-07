import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageCopy } from '../../../app/composables/message-copy'

describe('useMessageCopy', () => {
  let originalIsSecureContext: PropertyDescriptor | undefined
  let originalExecCommand: typeof document.execCommand

  beforeEach(() => {
    originalIsSecureContext = Object.getOwnPropertyDescriptor(
      window,
      'isSecureContext',
    )
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    vi.stubGlobal('ClipboardItem', class {
      items: Record<string, Blob>

      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    })

    originalExecCommand = document.execCommand
    document.execCommand = vi.fn().mockReturnValue(false)
  })

  afterEach(() => {
    if (originalIsSecureContext) {
      Object.defineProperty(
        window,
        'isSecureContext',
        originalIsSecureContext,
      )
    }

    document.execCommand = originalExecCommand
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('copyRich', () => {
    it('writes both html and plain text flavors via the Clipboard API', async () => {
      const { copyRich } = useMessageCopy()

      const succeeded = await copyRich({
        html: '<strong>hello</strong>',
        text: 'hello',
      })

      expect(succeeded).toBe(true)
      expect(navigator.clipboard.write).toHaveBeenCalledTimes(1)

      const [items] = vi.mocked(navigator.clipboard.write).mock.calls[0]
      const [item] = items as unknown as { items: Record<string, Blob> }[]

      expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain'])
    })

    it('falls back to writeText when the rich write rejects', async () => {
      vi.mocked(navigator.clipboard.write).mockRejectedValue(
        new Error('denied'),
      )

      const { copyRich } = useMessageCopy()

      const succeeded = await copyRich({
        html: '<strong>hello</strong>',
        text: 'hello',
      })

      expect(succeeded).toBe(true)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    })

    it('falls back to execCommand when writeText also rejects', async () => {
      vi.mocked(navigator.clipboard.write).mockRejectedValue(
        new Error('denied'),
      )
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
        new Error('denied'),
      )
      vi.mocked(document.execCommand).mockReturnValue(true)

      const { copyRich } = useMessageCopy()

      const succeeded = await copyRich({
        html: '<strong>hello</strong>',
        text: 'hello',
      })

      expect(succeeded).toBe(true)
      expect(document.execCommand).toHaveBeenCalledWith('copy')
    })

    it('returns false when every fallback fails', async () => {
      vi.mocked(navigator.clipboard.write).mockRejectedValue(
        new Error('denied'),
      )
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
        new Error('denied'),
      )

      const { copyRich } = useMessageCopy()

      const succeeded = await copyRich({
        html: '<strong>hello</strong>',
        text: 'hello',
      })

      expect(succeeded).toBe(false)
    })

    it('skips the rich write path outside a secure context', async () => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
      })

      const { copyRich } = useMessageCopy()

      const succeeded = await copyRich({
        html: '<strong>hello</strong>',
        text: 'hello',
      })

      expect(succeeded).toBe(true)
      expect(navigator.clipboard.write).not.toHaveBeenCalled()
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    })
  })

  describe('copyPlain', () => {
    it('writes plain text via the Clipboard API', async () => {
      const { copyPlain } = useMessageCopy()

      const succeeded = await copyPlain('hello')

      expect(succeeded).toBe(true)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    })

    it('falls back to execCommand when writeText rejects', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
        new Error('denied'),
      )
      vi.mocked(document.execCommand).mockReturnValue(true)

      const { copyPlain } = useMessageCopy()

      const succeeded = await copyPlain('hello')

      expect(succeeded).toBe(true)
      expect(document.execCommand).toHaveBeenCalledWith('copy')
    })

    it('returns false when writeText and execCommand both fail', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
        new Error('denied'),
      )

      const { copyPlain } = useMessageCopy()

      const succeeded = await copyPlain('hello')

      expect(succeeded).toBe(false)
    })
  })
})
