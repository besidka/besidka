import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileDownload } from '../../../app/composables/file-download'
import { useMessages } from '../../../app/composables/messages'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.wordprocessingml.document'
const IPHONE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 '
  + 'Safari/604.1'
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

const target = {
  url: '/files/plan-1.docx?download=1',
  fileName: 'Plan',
}

function setUserAgent(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
}

function setStandalone(isStandalone: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(navigator, 'standalone', {
    value: isStandalone,
    configurable: true,
  })
}

function stubShare(share: () => Promise<void> = async () => {}) {
  const shareMock = vi.fn(share)

  Object.defineProperty(navigator, 'share', {
    value: shareMock,
    configurable: true,
  })
  Object.defineProperty(navigator, 'canShare', {
    value: () => true,
    configurable: true,
  })

  return shareMock
}

function stubFetch() {
  const fetchMock = vi.fn(async () => {
    return new Response(new Blob(['docx'], { type: DOCX_TYPE }), {
      headers: {
        'content-type': DOCX_TYPE,
        'content-disposition':
          'attachment; filename="Plan.docx"; filename*=UTF-8\'\'Plan.docx',
      },
    })
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function createClick() {
  return new MouseEvent('click', { cancelable: true })
}

function messageTitles(): string[] {
  return useMessages().value.map((message) => {
    return message.title
  })
}

function createBlobTarget(key = 'diagram:download-svg:abc') {
  const build = vi.fn(async () => {
    return new Blob(['<svg/>'], { type: 'image/svg+xml' })
  })

  return {
    build,
    target: { key, fileName: 'diagram.svg', build },
  }
}

describe('composables/file-download', () => {
  let anchorClick: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useMessages().value = []
    setStandalone(false)
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
    Reflect.deleteProperty(navigator, 'standalone')
  })

  describe('off iOS', () => {
    beforeEach(() => {
      setUserAgent(DESKTOP_USER_AGENT)
    })

    it('leaves the native download untouched', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(share).not.toHaveBeenCalled()
    })

    it('reports a failed build as failed so the caller can say so', async () => {
      const result = await useFileDownload().downloadBlob({
        key: 'diagram:download-png:abc',
        fileName: 'diagram.png',
        build: async () => {
          throw new Error('render failed')
        },
      })

      expect(result).toBe('failed')
      expect(messageTitles()).toEqual([])
    })

    it('downloads a blob through an anchor', async () => {
      const createObjectURL = vi.fn(() => 'blob:test')

      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL,
        revokeObjectURL: vi.fn(),
      }))

      const { target: blobTarget } = createBlobTarget()
      const result = await useFileDownload().downloadBlob(blobTarget)

      expect(result).toBe('ok')
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(anchorClick).toHaveBeenCalledOnce()
    })
  })

  describe('in an iOS Safari tab', () => {
    beforeEach(() => {
      setUserAgent(IPHONE_USER_AGENT)
      setStandalone(false)
    })

    it('keeps the native download even with share support', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(share).not.toHaveBeenCalled()
      expect(messageTitles()).toEqual([])
    })

    it('downloads a blob through an anchor', async () => {
      const share = stubShare()

      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      }))

      const { target: blobTarget } = createBlobTarget()

      await useFileDownload().downloadBlob(blobTarget)

      expect(anchorClick).toHaveBeenCalledOnce()
      expect(share).not.toHaveBeenCalled()
    })
  })

  describe('in the iOS home-screen app with the share sheet', () => {
    beforeEach(() => {
      setUserAgent(IPHONE_USER_AGENT)
      setStandalone(true)
    })

    it('shares the downloaded file instead of navigating to it', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(target.url, {
        credentials: 'same-origin',
        signal: expect.any(AbortSignal),
      })
      expect(share).toHaveBeenCalledOnce()

      const [shared] = share.mock.calls[0] as unknown as [{ files: File[] }]

      expect(shared.files[0]?.name).toBe('Plan.docx')
      expect(shared.files[0]?.type).toBe(DOCX_TYPE)
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('never fetches an empty URL', async () => {
      stubShare()

      const fetchMock = stubFetch()

      await useFileDownload().onDownloadClick(createClick(), {
        url: '',
        fileName: 'Plan',
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(messageTitles()).toEqual(['Failed to download the file'])
    })

    it('stays quiet when the user closes the share sheet', async () => {
      stubShare(async () => {
        throw new DOMException('closed', 'AbortError')
      })
      stubFetch()

      await useFileDownload().onDownloadClick(createClick(), target)

      expect(messageTitles()).toEqual([])
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('asks for a second tap when the gesture expired, then shares the kept file without fetching', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )

      await useFileDownload().onDownloadClick(createClick(), target)

      expect(messageTitles()).toEqual(['Plan.docx is ready'])
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(share).toHaveBeenCalledOnce()

      const secondTap = useFileDownload()
        .onDownloadClick(createClick(), target)

      expect(share).toHaveBeenCalledTimes(2)

      await secondTap

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('stops asking for a tap when the kept file is refused too', async () => {
      const share = stubShare()

      stubFetch()
      share.mockRejectedValue(
        new DOMException('no gesture', 'NotAllowedError'),
      )

      await useFileDownload().onDownloadClick(createClick(), target)
      await useFileDownload().onDownloadClick(createClick(), target)

      expect(messageTitles()).toEqual([
        'Failed to save the file',
        'Plan.docx is ready',
      ])
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('forgets a kept file after 60 seconds', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })

      const share = stubShare()
      const fetchMock = stubFetch()

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().onDownloadClick(createClick(), target)
      vi.setSystemTime(Date.now() + 61_000)
      await useFileDownload().onDownloadClick(createClick(), target)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('forgets a kept file when the page is hidden', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().onDownloadClick(createClick(), target)

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      await useFileDownload().onDownloadClick(createClick(), target)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('reports a failed fetch and never navigates to the file', async () => {
      stubShare()
      vi.stubGlobal('fetch', vi.fn(async () => {
        return new Response('nope', { status: 404 })
      }))
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(true)
      expect(messageTitles()).toEqual(['Failed to download the file'])
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('tells the user when a second tap is swallowed while a share is open', async () => {
      let finishShare = () => {}
      const share = stubShare(() => {
        return new Promise<void>((resolve) => {
          finishShare = resolve
        })
      })
      const fetchMock = stubFetch()

      const firstTap = useFileDownload()
        .onDownloadClick(createClick(), target)

      await vi.waitFor(() => {
        expect(share).toHaveBeenCalledOnce()
      })
      await useFileDownload().onDownloadClick(createClick(), target)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(share).toHaveBeenCalledOnce()
      expect(messageTitles()).toEqual(['Still preparing the previous file'])

      finishShare()
      await firstTap
    })

    it('releases the guard after a failure', async () => {
      const share = stubShare()

      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('network')
      }))
      await useFileDownload().onDownloadClick(createClick(), target)
      stubFetch()
      await useFileDownload().onDownloadClick(createClick(), target)

      expect(share).toHaveBeenCalledOnce()
    })

    it('shares a blob with the given name and reports it saved', async () => {
      const share = stubShare()
      const { target: blobTarget } = createBlobTarget()

      const result = await useFileDownload().downloadBlob(blobTarget)
      const [shared] = share.mock.calls[0] as unknown as [{ files: File[] }]

      expect(result).toBe('ok')
      expect(shared.files[0]?.name).toBe('diagram.svg')
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('shares the kept blob on the second tap without building it again', async () => {
      const share = stubShare()
      const { build, target: blobTarget } = createBlobTarget()

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )

      const firstResult = await useFileDownload().downloadBlob(blobTarget)

      expect(firstResult).toBe('ok')
      expect(build).toHaveBeenCalledOnce()
      expect(messageTitles()).toEqual(['diagram.svg is ready'])

      const secondTap = useFileDownload().downloadBlob(blobTarget)

      expect(share).toHaveBeenCalledTimes(2)

      await expect(secondTap).resolves.toBe('ok')
      expect(build).toHaveBeenCalledOnce()
    })

    it('does not mix kept blobs of different exports', async () => {
      const share = stubShare()
      const first = createBlobTarget('diagram:download-svg:aaa')
      const second = createBlobTarget('diagram:download-svg:bbb')

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().downloadBlob(first.target)
      await useFileDownload().downloadBlob(second.target)

      expect(second.build).toHaveBeenCalledOnce()
    })

    it('reports a failed build once, with a single toast', async () => {
      stubShare()

      const result = await useFileDownload().downloadBlob({
        key: 'diagram:download-png:abc',
        fileName: 'diagram.png',
        build: async () => {
          throw new Error('render failed')
        },
      })

      expect(result).toBe('reported')
      expect(messageTitles()).toEqual(['Failed to download the file'])
    })

    it('reports a swallowed tap once, with a single toast', async () => {
      let finishShare = () => {}
      const share = stubShare(() => {
        return new Promise<void>((resolve) => {
          finishShare = resolve
        })
      })
      const first = createBlobTarget('diagram:download-svg:aaa')
      const second = createBlobTarget('diagram:download-svg:aaa')

      const firstTap = useFileDownload().downloadBlob(first.target)

      await vi.waitFor(() => {
        expect(share).toHaveBeenCalledOnce()
      })

      const secondResult = await useFileDownload().downloadBlob(second.target)

      expect(secondResult).toBe('reported')
      expect(messageTitles()).toEqual(['Still preparing the previous file'])

      finishShare()
      await expect(firstTap).resolves.toBe('ok')
    })

    it('evicts a kept file after 60 seconds without any tap', async () => {
      vi.useFakeTimers()

      const share = stubShare()
      const { build, target: blobTarget } = createBlobTarget('diagram:x:ttl')

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().downloadBlob(blobTarget)

      expect(vi.getTimerCount()).toBe(1)

      vi.advanceTimersByTime(60_000)

      expect(vi.getTimerCount()).toBe(0)

      await useFileDownload().downloadBlob(blobTarget)

      expect(build).toHaveBeenCalledTimes(2)
    })

    it('stops the eviction timer when the kept file is used', async () => {
      vi.useFakeTimers()

      const share = stubShare()
      const { target: blobTarget } = createBlobTarget('diagram:x:used')

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().downloadBlob(blobTarget)
      await useFileDownload().downloadBlob(blobTarget)

      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops the eviction timer when the page is hidden', async () => {
      vi.useFakeTimers()

      const share = stubShare()
      const { target: blobTarget } = createBlobTarget('diagram:x:hidden')

      share.mockRejectedValueOnce(
        new DOMException('no gesture', 'NotAllowedError'),
      )
      await useFileDownload().downloadBlob(blobTarget)
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))

      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('in the iOS home-screen app without a share sheet', () => {
    beforeEach(() => {
      setUserAgent(IPHONE_USER_AGENT)
      setStandalone(true)
    })

    it('never navigates the app to the file', async () => {
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(true)
      expect(messageTitles()).toEqual([
        'This file cannot be saved from the app',
      ])
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it('reports an unsupported blob once, with a single toast', async () => {
      const { target: blobTarget } = createBlobTarget()

      await expect(useFileDownload().downloadBlob(blobTarget))
        .resolves.toBe('reported')
      expect(messageTitles()).toEqual([
        'This file cannot be saved from the app',
      ])
      expect(anchorClick).not.toHaveBeenCalled()
    })
  })
})
