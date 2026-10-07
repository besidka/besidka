const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0'
  + '/api.js?render=explicit'

const FLEXIBLE_WIDGET_MIN_WIDTH = 300

interface TurnstileRenderWidgetOptions {
  action: string
  onInteractiveChange?: (isInteractive: boolean) => void
}

const pendingExecutions = new Map<string, (token: string) => void>()

export function useTurnstileLoadFailed() {
  return useState<boolean>('turnstile:load-failed', () => false)
}

function settlePendingExecution(widgetId: string): void {
  pendingExecutions.get(widgetId)?.('')
  pendingExecutions.delete(widgetId)
}

export function useTurnstile() {
  const config = useRuntimeConfig()
  const loadFailed = useTurnstileLoadFailed()
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
    let turnstile: Awaited<ReturnType<typeof turnstileScript.load>>

    try {
      turnstile = await turnstileScript.load()
    } catch {
      loadFailed.value = true

      return null
    }

    if (!turnstile) {
      loadFailed.value = true

      return null
    }

    loadFailed.value = false

    const containerWidth = el.clientWidth
    const isNarrowContainer = containerWidth > 0
      && containerWidth < FLEXIBLE_WIDGET_MIN_WIDTH
    const size = isNarrowContainer ? 'compact' : 'flexible'

    function settleWithEmptyToken() {
      settlePendingExecution(widgetId)
    }

    const widgetId = turnstile.render(el, {
      'sitekey': siteKey,
      'action': opts.action,
      'size': size,
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
      'before-interactive-callback': () => {
        opts.onInteractiveChange?.(true)
      },
      'after-interactive-callback': () => {
        opts.onInteractiveChange?.(false)
      },
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
    settlePendingExecution(widgetId)
    window.turnstile?.reset(widgetId)
  }

  function remove(widgetId: string): void {
    settlePendingExecution(widgetId)
    window.turnstile?.remove(widgetId)
  }

  return {
    isEnabled,
    loadFailed,
    renderWidget,
    execute,
    reset,
    remove,
  }
}
