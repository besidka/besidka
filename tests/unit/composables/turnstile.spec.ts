import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTurnstile } from '../../../app/composables/turnstile'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: 'test-sitekey',
  useScript: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { turnstileSiteKey: mocks.turnstileSiteKey },
  })
})

mockNuxtImport('useScript', () => mocks.useScript)

function createFakeTurnstileApi(
  onRender?: (el: HTMLElement, options: any) => void,
) {
  return {
    render: vi.fn((el: HTMLElement, options: any) => {
      onRender?.(el, options)

      return 'widget-1'
    }),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(),
  }
}

function mockScriptResolvingTo(turnstileApi: unknown) {
  const load = vi.fn(() => Promise.resolve(turnstileApi))
  const scriptInstance = {
    load,
    status: 'awaitingLoad',
    onLoaded: vi.fn(),
    onError: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
  }

  mocks.useScript.mockReturnValue(scriptInstance)

  return scriptInstance
}

describe('useTurnstile', () => {
  beforeEach(() => {
    mocks.turnstileSiteKey = 'test-sitekey'
    mocks.useScript.mockReset()
    delete (window as any).turnstile
  })

  it('is disabled and resolves execute() to an empty token with no sitekey configured', async () => {
    mocks.turnstileSiteKey = ''

    const scriptInstance = mockScriptResolvingTo(createFakeTurnstileApi())

    const turnstile = useTurnstile()

    expect(turnstile.isEnabled.value).toBe(false)

    const token = await turnstile.execute('widget-1')

    expect(token).toBe('')
    expect(scriptInstance.load).not.toHaveBeenCalled()
  })

  it('loads the Turnstile script exactly once across repeated renderWidget calls', async () => {
    let resolveLoad: (api: unknown) => void = () => {}
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve
    })
    const scriptInstance = {
      load: vi.fn(() => loadPromise),
      status: 'awaitingLoad',
      onLoaded: vi.fn(),
      onError: vi.fn(),
      remove: vi.fn(),
      reload: vi.fn(),
    }

    mocks.useScript.mockReturnValue(scriptInstance)

    const turnstile = useTurnstile()
    const fakeTurnstile = createFakeTurnstileApi()

    const containerOne = document.createElement('div')
    const containerTwo = document.createElement('div')

    const renderOnePromise = turnstile.renderWidget(containerOne, {
      action: 'auth',
    })
    const renderTwoPromise = turnstile.renderWidget(containerTwo, {
      action: 'auth',
    })

    window.turnstile = fakeTurnstile as any
    resolveLoad(fakeTurnstile)

    await renderOnePromise
    await renderTwoPromise

    expect(mocks.useScript).toHaveBeenCalledTimes(1)
    expect(mocks.useScript).toHaveBeenCalledWith(
      expect.stringContaining('turnstile/v0/api.js'),
      expect.objectContaining({ trigger: 'manual' }),
    )
    expect(scriptInstance.load).toHaveBeenCalledTimes(2)
    expect(fakeTurnstile.render).toHaveBeenCalledTimes(2)
    expect(fakeTurnstile.render).toHaveBeenCalledWith(
      containerOne,
      expect.objectContaining({
        sitekey: 'test-sitekey',
        action: 'auth',
      }),
    )
  })

  it('resolves execute() with the token passed to the render callback', async () => {
    let capturedCallback: ((token: string) => void) | undefined

    const fakeTurnstile = createFakeTurnstileApi((_el, options) => {
      capturedCallback = options.callback
    })

    window.turnstile = fakeTurnstile as any
    mockScriptResolvingTo(fakeTurnstile)

    const turnstile = useTurnstile()

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })
    const executePromise = turnstile.execute(widgetId!)

    capturedCallback?.('captcha-token')

    await expect(executePromise).resolves.toBe('captcha-token')
    expect(fakeTurnstile.execute).toHaveBeenCalledWith(widgetId)
  })

  it('resolves execute() to an empty token when the widget times out', async () => {
    let capturedTimeoutCallback: (() => void) | undefined

    const fakeTurnstile = createFakeTurnstileApi((_el, options) => {
      capturedTimeoutCallback = options['timeout-callback']
    })

    window.turnstile = fakeTurnstile as any
    mockScriptResolvingTo(fakeTurnstile)

    const turnstile = useTurnstile()

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })
    const executePromise = turnstile.execute(widgetId!)

    capturedTimeoutCallback?.()

    await expect(executePromise).resolves.toBe('')
  })

  it('resolves renderWidget() to null when the script fails to load', async () => {
    mockScriptResolvingTo(false)

    const turnstile = useTurnstile()

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })

    expect(widgetId).toBeNull()
  })

  it('reset() clears the pending token so a stale callback cannot resolve a later execute()', async () => {
    let capturedCallback: ((token: string) => void) | undefined

    const fakeTurnstile = createFakeTurnstileApi((_el, options) => {
      capturedCallback = options.callback
    })

    window.turnstile = fakeTurnstile as any
    mockScriptResolvingTo(fakeTurnstile)

    const turnstile = useTurnstile()

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })

    turnstile.execute(widgetId!)
    turnstile.reset(widgetId!)

    expect(fakeTurnstile.reset).toHaveBeenCalledWith(widgetId)

    capturedCallback?.('stale-token')

    const secondExecute = turnstile.execute(widgetId!)

    capturedCallback?.('fresh-token')

    await expect(secondExecute).resolves.toBe('fresh-token')
  })
})
