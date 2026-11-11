import type { Theme } from '@besidka/artifacts-protocol'
import { reportError } from '../report.ts'
import {
  createButton,
  createRenderLoop,
  createShell,
  readSource,
  showOutcome,
} from './chrome.ts'
import type { KitController, KitShell } from './chrome.ts'
import { highlightCode } from './highlighter.ts'
import { copyThroughHost } from './host-actions.ts'
import { PLAIN_LANGUAGE, resolveLanguage } from './languages.ts'

const COLLAPSE_LINE_COUNT = 3

const COPY_LABELS = {
  idleIcon: 'copy',
  idle: 'Copy',
  done: 'Copied!',
  failed: 'Copy failed',
} as const

function countLines(source: string): number {
  return source.split('\n').length
}

function renderPlain(body: HTMLElement, source: string) {
  const pre = document.createElement('pre')
  const code = document.createElement('code')

  code.textContent = source
  pre.append(code)
  body.replaceChildren(pre)
}

/**
 * Renders `<besidka-code>` like the chat's code block: window dots, the
 * language, Expand/Collapse from three lines on, Copy through the host,
 * and Shiki highlighting with the chat's themes.
 */
export function createCodeController(element: HTMLElement): KitController {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
  const shell: KitShell = createShell(root, PLAIN_LANGUAGE)
  const expandButton = createButton('besidka-code-expand', 'expand', 'Expand')
  const copyButton = createButton('besidka-code-copy', 'copy', 'Copy')
  let source = ''
  let expanded = false
  let renderSequence = 0

  shell.block.dataset.testid = 'besidka-code'
  shell.body.dataset.testid = 'besidka-code-body'

  function applyExpanded() {
    const collapsible = countLines(source) >= COLLAPSE_LINE_COUNT

    expandButton.element.hidden = !collapsible
    expandButton.set(
      expanded ? 'collapse' : 'expand',
      expanded ? 'Collapse' : 'Expand',
    )
    shell.body.dataset.collapsed = String(collapsible && !expanded)
  }

  expandButton.element.addEventListener('click', () => {
    expanded = !expanded
    applyExpanded()
  })
  copyButton.element.addEventListener('click', async (event) => {
    const outcome = await copyThroughHost(source, event)

    showOutcome(copyButton, outcome, COPY_LABELS)
  })
  shell.actions.append(expandButton.element, copyButton.element)

  async function render(theme: Theme) {
    const sequence = ++renderSequence
    const requestedLanguage = element.getAttribute('lang')
    const language = resolveLanguage(requestedLanguage)

    source = readSource(element)
    shell.setTheme(theme)
    shell.label.textContent = requestedLanguage?.trim() || PLAIN_LANGUAGE
    applyExpanded()

    if (!shell.body.firstChild) {
      renderPlain(shell.body, source)
    }

    try {
      const html = await highlightCode(source, language, theme)

      if (sequence !== renderSequence) {
        return
      }

      shell.body.innerHTML = html
      shell.body.dataset.theme = theme
    } catch (exception) {
      if (sequence === renderSequence) {
        renderPlain(shell.body, source)
      }

      reportError(exception, { level: 'warning', showPanel: false })
    }
  }

  return createRenderLoop(element, (theme) => {
    render(theme)
  })
}
