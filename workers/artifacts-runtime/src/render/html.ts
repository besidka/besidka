import { removeNavigatingElements } from './inert.ts'
import {
  beginInlineScript,
  endInlineScript,
  findInlineScripts,
  forgetModuleScript,
  matchScriptLines,
  registerModuleScript,
} from './script-location.ts'

const DEFERRED_SCRIPT_ATTRIBUTE = 'data-besidka-script-type'

const DEFERRED_SCRIPT_TYPE = 'text/x-besidka-deferred'

const SCRIPT_LINE_ATTRIBUTE = 'data-besidka-script-line'

const RUNTIME_SCRIPT_ATTRIBUTES = new Set([
  'type',
  DEFERRED_SCRIPT_ATTRIBUTE,
  SCRIPT_LINE_ATTRIBUTE,
])

function deferScripts(parsed: Document, html: string) {
  const scripts = [...parsed.querySelectorAll('script')]
  const startLines = matchScriptLines(
    findInlineScripts(html),
    scripts.map((script) => {
      return script.textContent ?? ''
    }),
  )

  scripts.forEach((script, index) => {
    const startLine = startLines[index]

    if (startLine) {
      script.setAttribute(SCRIPT_LINE_ATTRIBUTE, String(startLine))
    }

    script.setAttribute(
      DEFERRED_SCRIPT_ATTRIBUTE,
      script.getAttribute('type') ?? '',
    )
    script.setAttribute('type', DEFERRED_SCRIPT_TYPE)
  })
}

function createRunnableScript(deferred: Element): HTMLScriptElement {
  const script = document.createElement('script')
  const originalType = deferred.getAttribute(DEFERRED_SCRIPT_ATTRIBUTE)

  for (const attribute of deferred.attributes) {
    if (RUNTIME_SCRIPT_ATTRIBUTES.has(attribute.name)) {
      continue
    }

    script.setAttribute(attribute.name, attribute.value)
  }

  if (originalType) {
    script.setAttribute('type', originalType)
  }

  const source = deferred.textContent ?? ''

  if (script.type === 'module' && !script.hasAttribute('src')) {
    script.src = URL.createObjectURL(
      new Blob([source], { type: 'text/javascript' }),
    )

    return script
  }

  script.text = source

  return script
}

function readScriptLine(deferred: Element): number | null {
  const line = Number(deferred.getAttribute(SCRIPT_LINE_ATTRIBUTE))

  return Number.isSafeInteger(line) && line > 0 ? line : null
}

const SCRIPT_WAIT_LIMIT_MS = 5_000

function waitForScript(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, SCRIPT_WAIT_LIMIT_MS)
    const finish = () => {
      clearTimeout(timer)

      if (script.src.startsWith('blob:')) {
        forgetModuleScript(script.src)
        URL.revokeObjectURL(script.src)
      }

      resolve()
    }

    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', finish, { once: true })
  })
}

async function runDeferredScripts(isCurrent: () => boolean) {
  const deferredScripts = [
    ...document.querySelectorAll(`script[type="${DEFERRED_SCRIPT_TYPE}"]`),
  ]
  const pendingModules: Promise<void>[] = []

  for (const deferred of deferredScripts) {
    if (!isCurrent()) {
      return
    }

    if (!deferred.isConnected) {
      continue
    }

    const script = createRunnableScript(deferred)
    const isModule = script.type === 'module'
    const isBlockingExternal = script.hasAttribute('src')
      && !script.hasAttribute('async')
      && !isModule
    const loaded = isBlockingExternal || isModule ? waitForScript(script) : null
    const startLine = readScriptLine(deferred)

    if (isModule && script.src.startsWith('blob:')) {
      registerModuleScript(script.src, startLine)
    }

    beginInlineScript(script.hasAttribute('src') ? null : startLine)

    try {
      deferred.replaceWith(script)
    } finally {
      endInlineScript()
    }

    if (isModule && loaded) {
      pendingModules.push(loaded)
    } else if (loaded) {
      await loaded
    }
  }

  await Promise.all(pendingModules)
}

export function replaceDocumentRoot(html: string, afterReplace: () => void) {
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  removeNavigatingElements(parsed)
  deferScripts(parsed, html)
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  )
  afterReplace()
}

/**
 * Replaces the document's root element with the parsed artifact HTML (minus
 * `meta[http-equiv]` and `noscript`), runs its scripts in order and waits
 * for module scripts, then dispatches synthetic `DOMContentLoaded` and
 * `load`. Unlike `document.open()`, this does not fire a `load`
 * event on the host's iframe element, so the host can treat every `load`
 * after the first as the frame navigating away. The window, the MessagePort
 * and `window.besidka` stay the same; `afterReplace` restores the runtime's
 * document hooks on the new root before any artifact script runs.
 */
export async function replaceDocument(
  html: string,
  afterReplace: () => void,
  isCurrent: () => boolean,
) {
  replaceDocumentRoot(html, afterReplace)
  await runDeferredScripts(isCurrent)

  if (!isCurrent()) {
    return
  }

  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }))
  window.dispatchEvent(new Event('load'))
}
