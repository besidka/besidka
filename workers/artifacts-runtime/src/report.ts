import { MAX_LOG_MESSAGE_LENGTH } from '@besidka/artifacts-protocol'
import type { LogLevel, LogMessageParams } from '@besidka/artifacts-protocol'

type HostNotifier = (params: LogMessageParams) => void

interface ReportOptions {
  level?: LogLevel
  showPanel?: boolean
}

const MAX_REPORTS_PER_RENDER = 20

const ERROR_PANEL_ID = 'besidka-runtime-error'

const ERROR_PANEL_STYLE = [
  'position:fixed',
  'left:8px',
  'right:8px',
  'bottom:8px',
  'z-index:2147483647',
  'max-height:40vh',
  'overflow:auto',
  'margin:0',
  'padding:10px 12px',
  'border:1px solid #cf222e',
  'border-radius:8px',
  'background:#ffebe9',
  'color:#82071e',
  'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  'white-space:pre-wrap',
].join(';')

let notifyHost: HostNotifier | null = null
let reportsInCurrentRender = 0

export function setHostNotifier(notifier: HostNotifier) {
  notifyHost = notifier
}

export function resetReportBudget() {
  reportsInCurrentRender = 0
}

function truncate(value: string): string {
  if (value.length <= MAX_LOG_MESSAGE_LENGTH) {
    return value
  }

  return `${value.slice(0, MAX_LOG_MESSAGE_LENGTH - 1)}…`
}

export function describeError(error: unknown): LogMessageParams['data'] {
  if (error instanceof Error) {
    const message = truncate(`${error.name}: ${error.message}`)

    if (!error.stack) {
      return { message }
    }

    return { message, stack: truncate(error.stack) }
  }

  if (typeof error === 'string') {
    return { message: truncate(error) }
  }

  try {
    return { message: truncate(`Non-error thrown: ${JSON.stringify(error)}`) }
  } catch {
    return { message: 'Non-error thrown' }
  }
}

export function clearErrorPanel() {
  document.getElementById(ERROR_PANEL_ID)?.remove()
}

export function showErrorPanel(message: string) {
  const container = document.body ?? document.documentElement

  if (!container) {
    return
  }

  let panel = document.getElementById(ERROR_PANEL_ID)

  if (!panel) {
    panel = document.createElement('pre')
    panel.id = ERROR_PANEL_ID
    panel.setAttribute('role', 'alert')
    panel.setAttribute('style', ERROR_PANEL_STYLE)
    container.append(panel)
  }

  panel.textContent = panel.textContent
    ? `${panel.textContent}\n${message}`
    : message
}

export function reportError(error: unknown, options: ReportOptions = {}) {
  if (reportsInCurrentRender >= MAX_REPORTS_PER_RENDER) {
    return
  }

  reportsInCurrentRender += 1

  const level = options.level ?? 'error'
  const data = describeError(error)

  notifyHost?.({ level, data })

  if (options.showPanel ?? level === 'error') {
    showErrorPanel(data.message)
  }
}

const MUTED_SCRIPT_ERROR = 'Script error.'

const MUTED_SCRIPT_ERROR_HINT = 'Script error. The browser hid the details of this error; the browser console shows the full message.'

function handleWindowError(event: ErrorEvent) {
  if (!event.error && event.message === MUTED_SCRIPT_ERROR) {
    reportError(MUTED_SCRIPT_ERROR_HINT)

    return
  }

  reportError(event.error ?? event.message)
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  reportError(event.reason)
}

function handleSecurityPolicyViolation(event: SecurityPolicyViolationEvent) {
  const blocked = event.blockedURI || 'inline'

  reportError(
    `Blocked by the artifact sandbox (${event.effectiveDirective}): ${blocked}`,
    { level: 'warning', showPanel: false },
  )
}

/**
 * Safe to call after every document replacement: the browser ignores a
 * second registration of the same listener function.
 */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', handleWindowError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  document.addEventListener(
    'securitypolicyviolation',
    handleSecurityPolicyViolation,
  )
}
