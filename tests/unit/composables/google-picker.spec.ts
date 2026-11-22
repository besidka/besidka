import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

mockNuxtImport('$fetch', () => fetchMock)

interface FakeBuilderCall {
  token?: string
  key?: string
  appId?: string
  origin?: string
  maxItems?: number
  features: string[]
  views: Array<Record<string, unknown>>
}

type PickerCallback = (response: Record<string, unknown>) => void

const SCRIPT_URL = 'https://apis.google.com/js/api.js'

function httpError(status: number, message = 'Request failed') {
  return Object.assign(new Error(message), {
    status,
    data: { message, why: 'Because' },
  })
}

describe('useGooglePicker', () => {
  let appended: HTMLScriptElement[]
  let builderCall: FakeBuilderCall
  let pickerCallback: PickerCallback
  let picker: {
    setVisible: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }
  let gapiLoad: ReturnType<typeof vi.fn>

  function installPickerNamespace() {
    builderCall = { features: [], views: [] }
    picker = { setVisible: vi.fn(), dispose: vi.fn() }

    class DocsView {
      config: Record<string, unknown> = {}

      constructor(viewId?: string) {
        this.config.viewId = viewId
      }

      setIncludeFolders(value: boolean) {
        this.config.includeFolders = value

        return this
      }

      setSelectFolderEnabled(value: boolean) {
        this.config.selectFolderEnabled = value

        return this
      }

      setEnableDrives(value: boolean) {
        this.config.enableDrives = value

        return this
      }
    }

    class PickerBuilder {
      addView(view: DocsView) {
        builderCall.views.push(view.config)

        return this
      }

      enableFeature(feature: string) {
        builderCall.features.push(feature)

        return this
      }

      setMaxItems(value: number) {
        builderCall.maxItems = value

        return this
      }

      setOAuthToken(value: string) {
        builderCall.token = value

        return this
      }

      setDeveloperKey(value: string) {
        builderCall.key = value

        return this
      }

      setAppId(value: string) {
        builderCall.appId = value

        return this
      }

      setOrigin(value: string) {
        builderCall.origin = value

        return this
      }

      setCallback(callback: PickerCallback) {
        pickerCallback = callback

        return this
      }

      build() {
        return picker
      }
    }

    ;(window as any).google = {
      picker: {
        PickerBuilder,
        DocsView,
        ViewId: { DOCS: 'docs' },
        Feature: {
          MULTISELECT_ENABLED: 'multiselect',
          SUPPORT_DRIVES: 'drives',
        },
        Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
      },
    }
  }

  async function loadComposable() {
    vi.resetModules()

    const module = await import('../../../app/composables/google-picker')

    return module.useGooglePicker()
  }

  async function settle() {
    for (let turn = 0; turn < 6; turn++) {
      await Promise.resolve()
    }
  }

  async function finishScriptLoad() {
    await settle()

    const script = appended.at(-1)!

    ;(window as any).gapi = { load: gapiLoad }
    script.onload?.(new Event('load'))
    await settle()
  }

  beforeEach(() => {
    appended = []
    gapiLoad = vi.fn((
      _library: string,
      options: { callback: () => void },
    ) => {
      installPickerNamespace()
      options.callback()
    })
    delete (window as any).gapi
    delete (window as any).google
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      accessToken: 'picker-token',
      apiKey: 'public-key',
      appId: '123456789012',
      expiresInSeconds: 3000,
    })
    const appendToHead = document.head.appendChild.bind(document.head)

    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        appended.push(node)

        return node
      }

      return appendToHead(node)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as any).gapi
    delete (window as any).google
  })

  it('loads nothing until the user asks for Google Drive', async () => {
    await loadComposable()

    expect(appended).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for a token, loads Google\'s script, then the picker library',
    async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await finishScriptLoad()

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/google/drive/picker-token',
        { method: 'POST' },
      )
      expect(appended).toHaveLength(1)
      expect(appended[0]!.src).toBe(SCRIPT_URL)
      expect(gapiLoad).toHaveBeenCalledWith('picker', expect.objectContaining({
        callback: expect.any(Function),
        onerror: expect.any(Function),
        timeout: expect.any(Number),
      }))

      pickerCallback({ action: 'cancel' })
      await pending
    })

  it('builds the classic picker with the server token and no sign-in library',
    async () => {
      const { pick } = await loadComposable()
      const pending = pick({ maxItems: 3 })

      await finishScriptLoad()

      expect(builderCall).toMatchObject({
        token: 'picker-token',
        key: 'public-key',
        appId: '123456789012',
        origin: window.location.origin,
        maxItems: 3,
        features: ['multiselect', 'drives'],
        views: [{
          viewId: 'docs',
          includeFolders: true,
          selectFolderEnabled: false,
          enableDrives: true,
        }],
      })
      expect(picker.setVisible).toHaveBeenCalledWith(true)
      expect(appended.every((script) => {
        return !script.src.includes('accounts.google.com/gsi')
      })).toBe(true)

      pickerCallback({ action: 'cancel' })
      await pending
    })

  it('never asks for more files than the cap', async () => {
    const { pick } = await loadComposable()
    const pending = pick({ maxItems: 50 })

    await finishScriptLoad()

    expect(builderCall.maxItems).toBe(5)

    pickerCallback({ action: 'cancel' })
    await pending
  })

  it('returns the picked files with their resource key and drops folders',
    async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await finishScriptLoad()
      pickerCallback({
        action: 'picked',
        docs: [
          {
            id: 'file-1-aaaaaaaaaaaa',
            name: 'Plan',
            mimeType: 'application/vnd.google-apps.document',
            url: 'https://docs.google.com/document/d/file-1',
            resourceKey: 'key-1',
            driveSuccess: true,
          },
          {
            id: 'folder-1-aaaaaaaaaa',
            name: 'Folder',
            mimeType: 'application/vnd.google-apps.folder',
          },
          { id: 'file-2-aaaaaaaaaaaa', name: 'a.pdf', mimeType: 'application/pdf' },
        ],
      })

      const result = await pending

      expect(result).toEqual({
        status: 'picked',
        items: [
          {
            id: 'file-1-aaaaaaaaaaaa',
            name: 'Plan',
            mimeType: 'application/vnd.google-apps.document',
            url: 'https://docs.google.com/document/d/file-1',
            resourceKey: 'key-1',
          },
          {
            id: 'file-2-aaaaaaaaaaaa',
            name: 'a.pdf',
            mimeType: 'application/pdf',
          },
        ],
        rejected: [],
      })
      expect(JSON.stringify(result)).not.toContain('picker-token')
      expect(picker.dispose).toHaveBeenCalled()
    })

  it('reports the files Drive refused to share and keeps the others',
    async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await finishScriptLoad()
      pickerCallback({
        action: 'picked',
        docs: [
          {
            id: 'bad-1-aaaaaaaaaaaaa',
            name: 'Locked',
            mimeType: 'application/pdf',
            driveSuccess: false,
            driveError: 'The file is not shared',
          },
          { id: 'ok-1-aaaaaaaaaaaaaa', name: 'Open', mimeType: 'text/plain' },
        ],
      })

      expect(await pending).toMatchObject({
        status: 'picked',
        items: [{ id: 'ok-1-aaaaaaaaaaaaaa' }],
        rejected: [{ name: 'Locked', error: 'The file is not shared' }],
      })
    })

  it('answers a Drive error when every picked file was refused', async () => {
    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()
    pickerCallback({
      action: 'picked',
      docs: [{
        id: 'bad-1-aaaaaaaaaaaaa',
        name: 'Locked',
        mimeType: 'application/pdf',
        driveSuccess: false,
        driveError: 'The file is not shared',
      }],
    })

    expect(await pending).toMatchObject({
      status: 'error',
      code: 'drive-error',
    })
  })

  it('returns cancelled when the user closes the picker', async () => {
    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()
    pickerCallback({ action: 'cancel' })

    expect(await pending).toEqual({ status: 'cancelled' })
    expect(picker.setVisible).toHaveBeenLastCalledWith(false)
    expect(picker.dispose).toHaveBeenCalled()
  })

  it('reports a blocked script and loads it again on the next try',
    async () => {
      const { pick } = await loadComposable()
      const first = pick()

      await settle()
      appended.at(-1)!.onerror?.(new Event('error'))

      expect(await first).toMatchObject({
        status: 'error',
        code: 'script-blocked',
      })

      const second = pick()

      await finishScriptLoad()

      expect(appended).toHaveLength(2)

      pickerCallback({ action: 'cancel' })
      await second
    })

  it('reports a script that never loads as a timeout', async () => {
    vi.useFakeTimers()

    const { pick } = await loadComposable()
    const pending = pick()

    await vi.advanceTimersByTimeAsync(20_000)

    expect(await pending).toMatchObject({ status: 'error', code: 'timeout' })
  })

  it('reports a picker library that fails to load as blocked', async () => {
    gapiLoad.mockImplementation((
      _library: string,
      options: { onerror: () => void },
    ) => {
      options.onerror()
    })

    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()

    expect(await pending).toMatchObject({
      status: 'error',
      code: 'script-blocked',
    })
  })

  it('asks the user to check the Google sign-in when the picker never opens',
    async () => {
      vi.useFakeTimers()

      const { pick } = await loadComposable()
      const pending = pick()

      await vi.advanceTimersByTimeAsync(0)
      await finishScriptLoad()
      await vi.advanceTimersByTimeAsync(20_000)

      const result = await pending

      expect(result).toMatchObject({
        status: 'error',
        code: 'not-signed-in',
      })
      expect(JSON.stringify(result)).toContain('signed in to Google')
      expect(picker.dispose).toHaveBeenCalled()
    })

  it('does not time out once the picker has loaded, until it sits idle',
    async () => {
      vi.useFakeTimers()

      const { pick } = await loadComposable()
      const pending = pick()

      await vi.advanceTimersByTimeAsync(0)
      await finishScriptLoad()
      pickerCallback({ action: 'loaded' })
      await vi.advanceTimersByTimeAsync(60_000)

      pickerCallback({ action: 'cancel' })

      expect(await pending).toEqual({ status: 'cancelled' })
    })

  it('gives up on a picker left open for fifteen minutes', async () => {
    vi.useFakeTimers()

    const { pick } = await loadComposable()
    const pending = pick()

    await vi.advanceTimersByTimeAsync(0)
    await finishScriptLoad()
    pickerCallback({ action: 'loaded' })
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1)

    expect(await pending).toMatchObject({ status: 'error', code: 'timeout' })
  })

  it('loads the library once and opens the picker again from the cache',
    async () => {
      const { pick } = await loadComposable()
      const first = pick()

      await finishScriptLoad()
      pickerCallback({ action: 'cancel' })
      await first

      const second = pick()

      await settle()
      pickerCallback({ action: 'cancel' })
      await second

      expect(appended).toHaveLength(1)
      expect(gapiLoad).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

  it('ignores a second request while the picker is open', async () => {
    const { pick, isPicking } = await loadComposable()
    const first = pick()

    await finishScriptLoad()

    expect(isPicking.value).toBe(true)
    expect(await pick()).toEqual({ status: 'cancelled' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    pickerCallback({ action: 'cancel' })
    await first

    expect(isPicking.value).toBe(false)
  })

  describe('the token request', () => {
    it.each([
      [404, 'not-connected'],
      [409, 'reauthorize'],
      [503, 'not-configured'],
      [500, 'failed'],
    ])('maps a %s answer to %s without loading the script', async (
      status,
      code,
    ) => {
      fetchMock.mockRejectedValue(httpError(status))

      const { pick } = await loadComposable()
      const result = await pick()

      expect(result).toMatchObject({ status: 'error', code })
      expect(appended).toHaveLength(0)
    })
  })
})
