interface TurnstileRenderOptions {
  'sitekey': string
  'action'?: string
  'size'?: 'normal' | 'flexible' | 'compact'
  'appearance'?: 'always' | 'execute' | 'interaction-only'
  'execution'?: 'render' | 'execute'
  'callback'?: (token: string) => void
  'error-callback'?: (error?: unknown) => void
  'timeout-callback'?: () => void
  'expired-callback'?: () => void
  'unsupported-callback'?: () => void
  'before-interactive-callback'?: () => void
  'after-interactive-callback'?: () => void
}

interface TurnstileApi {
  render: (
    container: string | HTMLElement,
    options: TurnstileRenderOptions,
  ) => string
  execute: (widgetId?: string) => void
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
  getResponse: (widgetId?: string) => string | undefined
}

interface Window {
  turnstile?: TurnstileApi
}
