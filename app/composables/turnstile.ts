const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0'
  + '/api.js?render=explicit'

interface TurnstileRenderWidgetOptions {
  action: string
}

const pendingExecutions = new Map<string, (token: string) => void>()

export function useTurnstile() {
  const config = useRuntimeConfig()
  const siteKey = config.public.turnstileSiteKey

  const isEnabled = computed<boolean>(() => Boolean(siteKey))

  const turnstileScript = useScript(TURNSTILE_SCRIPT_URL, {
    trigger: 'manual',
    use: () => window.turnstile,
  })

  async function renderWidget(
    el: HTMLElement,
    opts: TurnstileRenderWidgetOptions,
  ): Promise<string | null> {
    const turnstile = await turnstileScript.load()

    if (!turnstile) {
      return null
    }

    function settleWithEmptyToken() {
      pendingExecutions.get(widgetId)?.('')
      pendingExecutions.delete(widgetId)
    }

    const widgetId = turnstile.render(el, {
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
