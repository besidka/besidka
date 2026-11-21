import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatDebugInfo } from '../../../app/composables/chat-debug-info'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  errorMessage: vi.fn(),
  write: vi.fn(),
  writeText: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const REPORT = 'Besidka debug info\nChat: x'

class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}

describe('useChatDebugInfo', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    mocks.write.mockReset()
    mocks.writeText.mockReset()
    mocks.fetch.mockResolvedValue({ report: REPORT })
    mocks.write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await items[0]!.items['text/plain']
    })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', {
      clipboard: { write: mocks.write, writeText: mocks.writeText },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies the report of the chat and flags success', async () => {
    const { copyDebugInfo, copied, fallbackReport } = useChatDebugInfo()

    await expect(copyDebugInfo(SLUG)).resolves.toBe(true)

    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/v1/chats/${SLUG}/support-info`,
    )

    const item = mocks.write.mock.calls[0]![0][0] as FakeClipboardItem
    const blob = await item.items['text/plain']

    expect(await blob!.text()).toBe(REPORT)
    expect(copied.value).toBe(true)
    expect(fallbackReport.value).toBe('')
  })

  it('writes text directly where clipboard items are unsupported',
    async () => {
      vi.stubGlobal('ClipboardItem', undefined)

      const { copyDebugInfo, copied } = useChatDebugInfo()

      await expect(copyDebugInfo(SLUG)).resolves.toBe(true)

      expect(mocks.writeText).toHaveBeenCalledWith(REPORT)
      expect(copied.value).toBe(true)
    })

  it('tries a plain text write when clipboard items fail', async () => {
    mocks.write.mockRejectedValue(new Error('NotSupportedError'))

    const { copyDebugInfo, copied, fallbackReport } = useChatDebugInfo()

    await expect(copyDebugInfo(SLUG)).resolves.toBe(true)

    expect(mocks.writeText).toHaveBeenCalledWith(REPORT)
    expect(copied.value).toBe(true)
    expect(fallbackReport.value).toBe('')
  })

  it('offers the report to select when the clipboard refuses', async () => {
    mocks.write.mockRejectedValue(new Error('NotAllowedError'))
    mocks.writeText.mockRejectedValue(new Error('NotAllowedError'))

    const { copyDebugInfo, copied, fallbackReport } = useChatDebugInfo()

    await expect(copyDebugInfo(SLUG)).resolves.toBe(false)

    expect(copied.value).toBe(false)
    expect(fallbackReport.value).toBe(REPORT)
    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'Could not copy automatically',
      'Select the text below and copy it.',
    )
  })

  it('clears the fallback report on demand', async () => {
    mocks.write.mockRejectedValue(new Error('NotAllowedError'))
    mocks.writeText.mockRejectedValue(new Error('NotAllowedError'))

    const { copyDebugInfo, fallbackReport, clearFallbackReport }
      = useChatDebugInfo()

    await copyDebugInfo(SLUG)
    expect(fallbackReport.value).toBe(REPORT)

    clearFallbackReport()

    expect(fallbackReport.value).toBe('')
  })

  it('reports a failed load and keeps the fallback empty', async () => {
    mocks.fetch.mockRejectedValue(new Error('boom'))
    mocks.write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await items[0]!.items['text/plain']
    })
    mocks.writeText.mockRejectedValue(new Error('boom'))

    const { copyDebugInfo, copied, fallbackReport } = useChatDebugInfo()

    await expect(copyDebugInfo(SLUG)).resolves.toBe(false)

    expect(copied.value).toBe(false)
    expect(fallbackReport.value).toBe('')
    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
  })

  it('explains a non-JSON refusal instead of showing the fetch summary',
    async () => {
      mocks.fetch.mockRejectedValue(Object.assign(
        new Error(`[GET] "/api/v1/chats/${SLUG}/support-info": 403 `),
        { status: 403, data: '<html>blocked</html>' },
      ))
      mocks.write.mockImplementation(async (items: FakeClipboardItem[]) => {
        await items[0]!.items['text/plain']
      })
      mocks.writeText.mockRejectedValue(new Error('boom'))

      const { copyDebugInfo } = useChatDebugInfo()

      await copyDebugInfo(SLUG)

      expect(mocks.errorMessage).toHaveBeenCalledWith(
        'Could not copy debug info',
        'The request was refused with status 403. Try again later.',
      )
    })

  it('shows the message of a structured app error', async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('Chat not found.'), {
      status: 404,
    }))
    mocks.write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await items[0]!.items['text/plain']
    })
    mocks.writeText.mockRejectedValue(new Error('boom'))

    const { copyDebugInfo } = useChatDebugInfo()

    await copyDebugInfo(SLUG)

    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'Could not copy debug info',
      'Chat not found.',
    )
  })

  it('ignores a second click while copying', async () => {
    let release: (value: { report: string }) => void = () => {}

    mocks.fetch.mockReturnValue(new Promise((resolve) => {
      release = resolve
    }))

    const { copyDebugInfo, isCopying } = useChatDebugInfo()
    const first = copyDebugInfo(SLUG)

    expect(isCopying.value).toBe(true)
    await expect(copyDebugInfo(SLUG)).resolves.toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    release({ report: REPORT })
    await first

    expect(isCopying.value).toBe(false)
  })
})
