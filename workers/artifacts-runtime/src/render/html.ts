const DEFERRED_SCRIPT_ATTRIBUTE = 'data-besidka-script-type'

const DEFERRED_SCRIPT_TYPE = 'text/x-besidka-deferred'

function deferScripts(parsed: Document) {
  for (const script of parsed.querySelectorAll('script')) {
    script.setAttribute(
      DEFERRED_SCRIPT_ATTRIBUTE,
      script.getAttribute('type') ?? '',
    )
    script.setAttribute('type', DEFERRED_SCRIPT_TYPE)
  }
}

function createRunnableScript(deferred: HTMLScriptElement): HTMLScriptElement {
  const script = document.createElement('script')
  const originalType = deferred.getAttribute(DEFERRED_SCRIPT_ATTRIBUTE)

  for (const attribute of deferred.attributes) {
    if (
      attribute.name === 'type'
      || attribute.name === DEFERRED_SCRIPT_ATTRIBUTE
    ) {
      continue
    }

    script.setAttribute(attribute.name, attribute.value)
  }

  if (originalType) {
    script.setAttribute('type', originalType)
  }

  script.text = deferred.text

  return script
}

function waitForScript(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve) => {
    script.addEventListener('load', () => {
      resolve()
    }, { once: true })
    script.addEventListener('error', () => {
      resolve()
    }, { once: true })
  })
}

async function runDeferredScripts() {
  const deferredScripts = [
    ...document.querySelectorAll<HTMLScriptElement>(
      `script[type="${DEFERRED_SCRIPT_TYPE}"]`,
    ),
  ]

  for (const deferred of deferredScripts) {
    if (!deferred.isConnected) {
      continue
    }

    const script = createRunnableScript(deferred)
    const isBlockingExternal = script.hasAttribute('src')
      && !script.hasAttribute('async')
      && script.type !== 'module'
    const loaded = isBlockingExternal ? waitForScript(script) : null

    deferred.replaceWith(script)

    if (loaded) {
      await loaded
    }
  }
}

export function replaceDocumentRoot(html: string, afterReplace: () => void) {
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  deferScripts(parsed)
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  )
  afterReplace()
}

/**
 * Replaces the document's root element with the parsed artifact HTML and
 * then runs its scripts in order, followed by synthetic `DOMContentLoaded`
 * and `load` events. Unlike `document.open()`, this does not fire a `load`
 * event on the host's iframe element, so the host can treat every `load`
 * after the first as the frame navigating away. The window, the MessagePort
 * and `window.besidka` stay the same; `afterReplace` restores the runtime's
 * document hooks on the new root before any artifact script runs.
 */
export async function replaceDocument(html: string, afterReplace: () => void) {
  replaceDocumentRoot(html, afterReplace)
  await runDeferredScripts()
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }))
  window.dispatchEvent(new Event('load'))
}
