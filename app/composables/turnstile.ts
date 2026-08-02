const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0'
  + '/api.js?render=explicit&onload=onloadTurnstileCallback'

interface TurnstileRenderWidgetOptions {
  action: string
}

let scriptLoadPromise: Promise<void> | null = null

const pendingExecutions = new Map<string, (token: string) => void>()

function loadTurnstileScript(): Promise<void> {
  if (!import.meta.client) {
    return Promise.resolve()
  }

  if (window.turnstile) {
    return Promise.resolve()
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    window.onloadTurnstileCallback = () => {
      resolve()
    }

    const script = document.createElement('script')

    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('error', () => {
      reject(new Error('Failed to load the Turnstile script'))
    })

    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export function useTurnstile() {
  const config = useRuntimeConfig()
  const siteKey = config.public.turnstileSiteKey

  const isEnabled = computed<boolean>(() => Boolean(siteKey))

  async function renderWidget(
    el: HTMLElement,
    opts: TurnstileRenderWidgetOptions,
  ): Promise<string> {
    await loadTurnstileScript()

    function settleWithEmptyToken() {
      pendingExecutions.get(widgetId)?.('')
      pendingExecutions.delete(widgetId)
    }

    const widgetId = window.turnstile!.render(el, {
      'sitekey': siteKey,
      'action': opts.action,
      'appearance': 'interaction-only',
      'execution': 'execute',
      'callback': (token: string) => {
        pendingExecutions.get(widgetId)?.(token)
        pendingExecutions.delete(widgetId)
      },
      'error-callback': settleWithEmptyToken,
      'timeout-callback': settleWithEmptyToken,
      'expired-callback': settleWithEmptyToken,
      'unsupported-callback': settleWithEmptyToken,
    })

    return widgetId
  }

  function execute(widgetId: string): Promise<string> {
    if (!isEnabled.value) {
      return Promise.resolve('')
    }

    return new Promise<string>((resolve) => {
      pendingExecutions.set(widgetId, resolve)
      window.turnstile?.execute(widgetId)
    })
  }

  function reset(widgetId: string): void {
    pendingExecutions.delete(widgetId)
    window.turnstile?.reset(widgetId)
  }

  function remove(widgetId: string): void {
    pendingExecutions.delete(widgetId)
    window.turnstile?.remove(widgetId)
  }

  return {
    isEnabled,
    renderWidget,
    execute,
    reset,
    remove,
  }
}
