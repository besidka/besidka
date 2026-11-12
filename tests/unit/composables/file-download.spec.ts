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

    it('downloads a blob through an anchor', async () => {
      const createObjectURL = vi.fn(() => 'blob:test')

      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL,
        revokeObjectURL: vi.fn(),
      }))

      await useFileDownload()
        .downloadBlob(new Blob(['x']), 'diagram.svg')

      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(anchorClick).toHaveBeenCalledOnce()
    })
  })

  describe('on iOS with the share sheet', () => {
    beforeEach(() => {
      setUserAgent(IPHONE_USER_AGENT)
    })

    it('shares the downloaded file instead of navigating to it', async () => {
      const share = stubShare()
      const fetchMock = stubFetch()
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(target.url, {
        credentials: 'same-origin',
      })
      expect(share).toHaveBeenCalledOnce()

      const [shared] = share.mock.calls[0] as unknown as [{ files: File[] }]

      expect(shared.files[0]?.name).toBe('Plan.docx')
      expect(shared.files[0]?.type).toBe(DOCX_TYPE)
      expect(anchorClick).not.toHaveBeenCalled()
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

    it('ignores a second tap while a share is still open', async () => {
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

      finishShare()
      await firstTap
    })

    it('shares a blob with the given name', async () => {
      const share = stubShare()

      await useFileDownload().downloadBlob(
        new Blob(['x'], { type: 'image/svg+xml' }),
        'diagram.svg',
      )

      const [shared] = share.mock.calls[0] as unknown as [{ files: File[] }]

      expect(shared.files[0]?.name).toBe('diagram.svg')
      expect(anchorClick).not.toHaveBeenCalled()
    })
  })

  describe('on iOS without a share sheet', () => {
    beforeEach(() => {
      setUserAgent(IPHONE_USER_AGENT)
    })

    it('keeps the native download in Safari', async () => {
      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(false)
      expect(messageTitles()).toEqual([])
    })

    it('never navigates the home-screen app to the file', async () => {
      setStandalone(true)

      const event = createClick()

      await useFileDownload().onDownloadClick(event, target)

      expect(event.defaultPrevented).toBe(true)
      expect(messageTitles()).toEqual([
        'This file cannot be saved from the app',
      ])
      expect(anchorClick).not.toHaveBeenCalled()
    })
  })
})
