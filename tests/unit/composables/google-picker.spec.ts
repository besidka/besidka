import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { EffectScope } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const STATUS_URL = '/api/v1/google/connections'

const { fetchMock, statusMock, routedFetch } = vi.hoisted(() => {
  const tokenMock = vi.fn()
  const connectionMock = vi.fn()

  return {
    fetchMock: tokenMock,
    statusMock: connectionMock,
    routedFetch: vi.fn((url: string, options?: unknown) => {
      return url === '/api/v1/google/connections'
        ? connectionMock(url, options)
        : tokenMock(url, options)
    }),
  }
})

mockNuxtImport('$fetch', () => routedFetch)

function notConnected() {
  return { ...activeConnection(), connection: null }
}

function activeConnection(
  capabilities: string[] = ['identity', 'drive-picked'],
) {
  return {
    connection: {
      clientMode: 'besidka',
      status: 'active',
      email: 'user@example.com',
      capabilities,
      connectedAt: '2026-11-22T10:00:00.000Z',
    },
    canConnect: true,
    dedicatedClient: true,
    byo: null,
  }
}

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

  async function loadComposable(scope?: EffectScope) {
    vi.resetModules()

    const module = await import('../../../app/composables/google-picker')

    return scope
      ? scope.run(() => module.useGooglePicker())!
      : module.useGooglePicker()
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
    statusMock.mockReset()
    statusMock.mockResolvedValue(activeConnection())
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

  it('returns canceled when the user closes the picker', async () => {
    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()
    pickerCallback({ action: 'cancel' })

    expect(await pending).toEqual({ status: 'canceled' })
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

  it('asks for a reload when the page policy blocks Google\'s frame, '
    + 'instead of waiting for the timeout', async () => {
    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()

    const violation = new Event('securitypolicyviolation')

    Object.assign(violation, {
      violatedDirective: 'frame-src',
      blockedURI: 'https://docs.google.com/picker?x=1',
    })
    document.dispatchEvent(violation)

    const result = await pending

    expect(result).toMatchObject({ status: 'error', code: 'blocked' })
    expect(JSON.stringify(result)).toContain('Reload the page')
    expect(picker.dispose).toHaveBeenCalled()
  })

  it('ignores a policy violation that is not Google\'s frame', async () => {
    const { pick } = await loadComposable()
    const pending = pick()

    await finishScriptLoad()

    const violation = new Event('securitypolicyviolation')

    Object.assign(violation, {
      violatedDirective: 'frame-src',
      blockedURI: 'https://tracker.example/frame',
    })
    document.dispatchEvent(violation)
    pickerCallback({ action: 'cancel' })

    expect(await pending).toEqual({ status: 'canceled' })
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

      expect(await pending).toEqual({ status: 'canceled' })
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
    expect(await pick()).toEqual({ status: 'canceled' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    pickerCallback({ action: 'cancel' })
    await first

    expect(isPicking.value).toBe(false)
  })

  describe('the connection check', () => {
    function expectNothingFromGoogle() {
      expect(appended).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(gapiLoad).not.toHaveBeenCalled()
    }

    it('loads no script and asks for no token when not connected',
      async () => {
        statusMock.mockResolvedValue(notConnected())

        const { pick } = await loadComposable()
        const result = await pick()

        expect(result).toMatchObject({ status: 'error', code: 'not-connected' })
        expect(statusMock).toHaveBeenCalledWith(STATUS_URL, undefined)
        expectNothingFromGoogle()
      })

    it('loads no script and asks for no token when re-authorization is '
      + 'needed', async () => {
      const response = activeConnection()

      response.connection.status = 'needs_reauth'
      statusMock.mockResolvedValue(response)

      const { pick } = await loadComposable()

      expect(await pick()).toMatchObject({
        status: 'error',
        code: 'reauthorize',
      })
      expectNothingFromGoogle()
    })

    it('treats an active connection without the picked files capability '
      + 'as needing re-authorization', async () => {
      statusMock.mockResolvedValue(activeConnection(['identity']))

      const { pick } = await loadComposable()

      expect(await pick()).toMatchObject({
        status: 'error',
        code: 'reauthorize',
      })
      expectNothingFromGoogle()
    })

    it('shows an error and loads nothing when the status request fails',
      async () => {
        statusMock.mockRejectedValue(httpError(500, 'Status unavailable'))

        const { pick } = await loadComposable()
        const result = await pick()

        expect(result).toMatchObject({
          status: 'error',
          code: 'failed',
          message: 'Status unavailable',
        })
        expectNothingFromGoogle()
      })

    it('checks the status, then loads the script, then asks for the token',
      async () => {
        const { pick } = await loadComposable()
        const pending = pick()

        await settle()

        expect(statusMock).toHaveBeenCalledTimes(1)
        expect(appended).toHaveLength(1)
        expect(fetchMock).not.toHaveBeenCalled()

        await finishScriptLoad()

        expect(fetchMock).toHaveBeenCalledTimes(1)

        pickerCallback({ action: 'cancel' })
        await pending
      })

    it('checks again on every call and never trusts an earlier answer',
      async () => {
        const { pick } = await loadComposable()
        const first = pick()

        await finishScriptLoad()
        pickerCallback({ action: 'cancel' })
        await first

        statusMock.mockResolvedValue(notConnected())

        expect(await pick()).toMatchObject({ code: 'not-connected' })
        expect(statusMock).toHaveBeenCalledTimes(2)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

    it('shows the pending flag only when the check takes over 300 ms',
      async () => {
        vi.useFakeTimers()

        let resolveStatus: (value: unknown) => void = () => undefined

        statusMock.mockReturnValue(new Promise((resolve) => {
          resolveStatus = resolve
        }))

        const { pick, isCheckingConnection } = await loadComposable()
        const pending = pick()

        await vi.advanceTimersByTimeAsync(299)

        expect(isCheckingConnection.value).toBe(false)

        await vi.advanceTimersByTimeAsync(1)

        expect(isCheckingConnection.value).toBe(true)

        resolveStatus(notConnected())

        expect(await pending).toMatchObject({ code: 'not-connected' })
        expect(isCheckingConnection.value).toBe(false)
      })

    it('never shows the pending flag for a fast check', async () => {
      vi.useFakeTimers()
      statusMock.mockResolvedValue(notConnected())

      const { pick, isCheckingConnection } = await loadComposable()

      await pick()
      await vi.advanceTimersByTimeAsync(1000)

      expect(isCheckingConnection.value).toBe(false)
    })
  })

  describe('the token request', () => {
    it.each([
      [404, 'not-connected'],
      [409, 'reauthorize'],
      [503, 'not-configured'],
      [500, 'failed'],
    ])('maps a %s answer to %s and opens no picker', async (
      status,
      code,
    ) => {
      fetchMock.mockRejectedValue(httpError(status))

      const { pick } = await loadComposable()
      const pending = pick()

      await finishScriptLoad()

      expect(await pending).toMatchObject({ status: 'error', code })
      expect(builderCall.token).toBeUndefined()
    })

    it('mints the token only after Google\'s script has loaded', async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await settle()

      expect(appended).toHaveLength(1)
      expect(fetchMock).not.toHaveBeenCalled()

      await finishScriptLoad()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      pickerCallback({ action: 'cancel' })
      await pending
    })

    it('mints no token when the script is blocked', async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await settle()
      appended.at(-1)!.onerror?.(new Event('error'))

      expect(await pending).toMatchObject({ code: 'script-blocked' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('the script tag', () => {
    it('sends no referrer to Google', async () => {
      const { pick } = await loadComposable()
      const pending = pick()

      await finishScriptLoad()

      expect(appended[0]!.referrerPolicy).toBe('no-referrer')

      pickerCallback({ action: 'cancel' })
      await pending
    })
  })

  describe('cleanup and focus', () => {
    it('closes an open picker when the owning scope is disposed', async () => {
      const scope = effectScope()
      const { pick } = await loadComposable(scope)
      const pending = pick()

      await finishScriptLoad()
      scope.stop()

      expect(await pending).toEqual({ status: 'canceled' })
      expect(picker.dispose).toHaveBeenCalled()
    })

    it('refuses to open after its scope is disposed', async () => {
      const scope = effectScope()
      const { pick } = await loadComposable(scope)

      scope.stop()

      expect(await pick()).toEqual({ status: 'canceled' })
      expect(appended).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns focus to the tools button when the picker closes',
      async () => {
        const trigger = document.createElement('button')

        trigger.className = 'js-chat-input-tools-trigger'
        document.body.appendChild(trigger)

        const { pick } = await loadComposable()
        const pending = pick()

        await finishScriptLoad()
        pickerCallback({ action: 'cancel' })
        await pending

        expect(document.activeElement).toBe(trigger)

        trigger.remove()
      })
  })

  describe('the idle timeout', () => {
    it('never outlives the access token', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue({
        accessToken: 'picker-token',
        apiKey: 'public-key',
        appId: '123456789012',
        expiresInSeconds: 120,
      })

      const { pick } = await loadComposable()
      const pending = pick()

      await vi.advanceTimersByTimeAsync(0)
      await finishScriptLoad()
      pickerCallback({ action: 'loaded' })
      await vi.advanceTimersByTimeAsync(121_000)

      expect(await pending).toMatchObject({ status: 'error', code: 'timeout' })
    })
  })
})
