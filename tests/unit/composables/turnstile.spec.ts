import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTurnstile } from '../../../app/composables/turnstile'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: 'test-sitekey',
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { turnstileSiteKey: mocks.turnstileSiteKey },
  })
})

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

describe('useTurnstile', () => {
  beforeEach(() => {
    mocks.turnstileSiteKey = 'test-sitekey'
    document.head.innerHTML = ''
    ;(window as any).happyDOM.settings.disableJavaScriptFileLoading = true
    ;(window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess
      = true
  })

  it('is disabled and resolves execute() to an empty token with no sitekey configured', async () => {
    mocks.turnstileSiteKey = ''

    const turnstile = useTurnstile()

    expect(turnstile.isEnabled.value).toBe(false)

    const token = await turnstile.execute('widget-1')

    expect(token).toBe('')
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })

  it('injects the Turnstile script exactly once across repeated renderWidget calls', async () => {
    delete (window as any).turnstile
    delete (window as any).onloadTurnstileCallback

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
    window.onloadTurnstileCallback?.()

    await renderOnePromise
    await renderTwoPromise

    const scripts = document.head.querySelectorAll('script')

    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.getAttribute('src')).toContain('turnstile/v0/api.js')
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
    const turnstile = useTurnstile()
    let capturedCallback: ((token: string) => void) | undefined

    window.turnstile = createFakeTurnstileApi((_el, options) => {
      capturedCallback = options.callback
    }) as any

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })
    const executePromise = turnstile.execute(widgetId)

    capturedCallback?.('captcha-token')

    await expect(executePromise).resolves.toBe('captcha-token')
  })

  it('resolves execute() to an empty token when the widget times out', async () => {
    const turnstile = useTurnstile()
    let capturedTimeoutCallback: (() => void) | undefined

    window.turnstile = createFakeTurnstileApi((_el, options) => {
      capturedTimeoutCallback = options['timeout-callback']
    }) as any

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })
    const executePromise = turnstile.execute(widgetId)

    capturedTimeoutCallback?.()

    await expect(executePromise).resolves.toBe('')
  })

  it('reset() clears the pending token so a stale callback cannot resolve a later execute()', async () => {
    const turnstile = useTurnstile()
    let capturedCallback: ((token: string) => void) | undefined

    window.turnstile = createFakeTurnstileApi((_el, options) => {
      capturedCallback = options.callback
    }) as any

    const container = document.createElement('div')
    const widgetId = await turnstile.renderWidget(container, {
      action: 'auth',
    })

    turnstile.execute(widgetId)
    turnstile.reset(widgetId)

    expect(window.turnstile?.reset).toHaveBeenCalledWith(widgetId)

    capturedCallback?.('stale-token')

    const secondExecute = turnstile.execute(widgetId)

    capturedCallback?.('fresh-token')

    await expect(secondExecute).resolves.toBe('fresh-token')
  })
})
