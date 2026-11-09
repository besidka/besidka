import type { Theme } from '@besidka/artifacts-protocol'
import { paletteDeclarations } from '../palette.ts'
import { getTheme, onThemeChange } from '../theme.ts'
import type { HostActionOutcome } from './host-actions.ts'

export type IconName = 'copy' | 'check' | 'x' | 'fullscreen' | 'expand' | 'collapse' | 'download'

export const FEEDBACK_DURATION_MS = 2_000

const ICON_PATHS: Record<IconName, string> = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  expand: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  collapse: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
}

export const KIT_STYLE = `
:host {
  display: block;
  margin: 1rem 0;
  text-align: initial;
}
:host([hidden]) {
  display: none;
}
.block {
  ${paletteDeclarations('light')}
  color: var(--besidka-fg);
  background: color-mix(in srgb, var(--besidka-bg) 50%, transparent);
  border: 1px solid var(--besidka-border);
  border-radius: 1rem;
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  overflow: hidden;
  font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.block[data-theme='dark'] {
  ${paletteDeclarations('dark')}
  color-scheme: dark;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.375rem 1rem;
}
.dots {
  display: inline-flex;
  gap: 0.375rem;
  flex-shrink: 0;
}
.dots i {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.3;
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--besidka-muted);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.5rem;
  padding: 0 0.5rem;
  color: inherit;
  font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: transparent;
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}
button:hover {
  background: color-mix(in srgb, var(--besidka-fg) 10%, transparent);
}
button:focus-visible {
  outline: 2px solid var(--besidka-accent);
  outline-offset: 1px;
}
button[data-state='failed'] {
  color: var(--besidka-danger);
}
button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.menu {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
  padding: 0 1rem 0.375rem;
}
.menu[hidden] {
  display: none;
}
.menu-title {
  align-self: center;
  margin-right: auto;
  color: var(--besidka-muted);
  font-size: 12px;
}
button[aria-expanded='true'] {
  background: color-mix(in srgb, var(--besidka-fg) 10%, transparent);
}
.body {
  padding: 1rem;
  overflow-x: auto;
  font-size: 14px;
}
.body[data-collapsed='true'] {
  max-height: 7.5rem;
  overflow-y: auto;
}
pre {
  margin: 0;
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
  tab-size: 2;
  background: transparent !important;
}
pre code {
  font: inherit;
}
.diagram {
  display: flex;
  justify-content: center;
  cursor: zoom-in;
}
.diagram svg {
  max-width: 100%;
  height: auto;
}
.error {
  margin: 0;
  padding: 0 1rem 0.75rem;
  color: var(--besidka-muted);
  font-size: 12px;
}
@media (max-width: 480px) {
  button .text {
    display: none;
  }
}
`.trim()

export function createIcon(name: IconName): SVGSVGElement {
  const template = document.createElement('template')

  template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`

  return template.content.firstElementChild as SVGSVGElement
}

export interface KitButton {
  element: HTMLButtonElement
  set: (icon: IconName, text: string, state?: 'failed') => void
}

export function createButton(
  testId: string,
  icon: IconName,
  text: string,
): KitButton {
  const element = document.createElement('button')

  element.type = 'button'
  element.dataset.testid = testId

  function set(nextIcon: IconName, nextText: string, state?: 'failed') {
    const label = document.createElement('span')

    label.className = 'text'
    label.textContent = nextText
    element.replaceChildren(createIcon(nextIcon), label)
    element.setAttribute('aria-label', nextText)

    if (state) {
      element.dataset.state = state
    } else {
      delete element.dataset.state
    }
  }

  set(icon, text)

  return { element, set }
}

export interface KitMenuItem<Action extends string> {
  action: Action
  label: string
}

export interface KitMenu {
  trigger: KitButton
  panel: HTMLDivElement
  close: () => void
}

/**
 * A toolbar button that shows its choices in a row under the toolbar
 * instead of a floating dropdown, which the block's rounded, clipped box
 * would cut off. One open menu per block: opening one closes the others.
 */
export function createMenu<Action extends string>(
  testId: string,
  icon: IconName,
  text: string,
  items: KitMenuItem<Action>[],
  onSelect: (action: Action, event: MouseEvent) => void,
): KitMenu {
  const trigger = createButton(testId, icon, text)
  const panel = document.createElement('div')
  const title = document.createElement('span')

  panel.className = 'menu'
  panel.hidden = true
  panel.dataset.testid = `${testId}-menu`
  panel.setAttribute('role', 'group')
  panel.setAttribute('aria-label', text)
  title.className = 'menu-title'
  title.textContent = text
  panel.append(title)
  trigger.element.setAttribute('aria-expanded', 'false')

  function close() {
    panel.hidden = true
    trigger.element.setAttribute('aria-expanded', 'false')
  }

  for (const item of items) {
    const option = document.createElement('button')

    option.type = 'button'
    option.textContent = item.label
    option.dataset.testid = `${testId}-${item.action}`
    option.addEventListener('click', (event) => {
      close()
      onSelect(item.action, event)
    })
    panel.append(option)
  }

  trigger.element.addEventListener('click', () => {
    const isOpening = panel.hidden

    for (const sibling of panel.parentElement?.querySelectorAll('.menu') ?? []) {
      (sibling as HTMLElement).hidden = true
    }

    for (const button of trigger.element.parentElement?.querySelectorAll(
      'button[aria-expanded]',
    ) ?? []) {
      button.setAttribute('aria-expanded', 'false')
    }

    panel.hidden = !isOpening
    trigger.element.setAttribute('aria-expanded', String(isOpening))
  })

  return { trigger, panel, close }
}

const outcomeResetTimers = new WeakMap<
  KitButton,
  ReturnType<typeof setTimeout>
>()

/**
 * Shows the outcome of a host action on its button for a moment, then
 * restores the idle label. A new outcome restarts that moment. A failure
 * keeps the host's reason in `title`.
 */
export function showOutcome(
  button: KitButton,
  outcome: HostActionOutcome,
  labels: { idleIcon: IconName, idle: string, done: string, failed: string },
) {
  const previousTimer = outcomeResetTimers.get(button)

  if (previousTimer) {
    clearTimeout(previousTimer)
  }

  if (outcome.ok) {
    button.set('check', labels.done)
    button.element.removeAttribute('title')
  } else {
    button.set('x', labels.failed, 'failed')
    button.element.title = outcome.message
  }

  outcomeResetTimers.set(button, setTimeout(() => {
    outcomeResetTimers.delete(button)
    button.set(labels.idleIcon, labels.idle)
  }, FEEDBACK_DURATION_MS))
}

export interface KitShell {
  block: HTMLDivElement
  label: HTMLSpanElement
  actions: HTMLDivElement
  body: HTMLDivElement
  setTheme: (theme: Theme) => void
}

export function createShell(root: ShadowRoot, labelText: string): KitShell {
  const style = document.createElement('style')
  const block = document.createElement('div')
  const toolbar = document.createElement('div')
  const dots = document.createElement('span')
  const label = document.createElement('span')
  const actions = document.createElement('div')
  const body = document.createElement('div')

  style.textContent = KIT_STYLE
  block.className = 'block'
  toolbar.className = 'toolbar'
  dots.className = 'dots'
  dots.setAttribute('aria-hidden', 'true')
  dots.append(
    document.createElement('i'),
    document.createElement('i'),
    document.createElement('i'),
  )
  label.className = 'label'
  label.textContent = labelText
  actions.className = 'actions'
  body.className = 'body'
  toolbar.append(dots, label, actions)
  block.append(toolbar, body)
  root.replaceChildren(style, block)

  return {
    block,
    label,
    actions,
    body,
    setTheme: (theme) => {
      block.dataset.theme = theme
    },
  }
}

function measureIndent(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * The element's text as source code. Text that starts on its own line
 * (`<besidka-code>` written across lines in HTML) loses its leading blank
 * lines and common indentation; text that starts on the first line is kept
 * as written apart from trailing whitespace, so Copy returns it exactly.
 */
export function readSource(element: HTMLElement): string {
  const text = (element.textContent ?? '').replace(/\r\n?/g, '\n').trimEnd()

  if (!/^[ \t]*\n/.test(text)) {
    return text
  }

  const lines = text.replace(/^(?:[ \t]*\n)+/, '').split('\n')
  const indents = lines.filter((line) => {
    return line.trim().length > 0
  }).map(measureIndent)
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0

  return lines.map((line) => {
    return line.slice(Math.min(commonIndent, measureIndent(line)))
  }).join('\n')
}

export interface KitController {
  connect: () => void
  disconnect: () => void
  refresh: () => void
}

/**
 * Wires an element's rerender to its own light-DOM text (React updates
 * children in place), its attributes and the host theme. Renders are
 * batched per animation frame.
 */
export function createRenderLoop(
  element: HTMLElement,
  render: (theme: Theme) => void,
): KitController {
  let frame = 0
  let stopThemeListener: (() => void) | null = null
  const observer = new MutationObserver(() => {
    schedule()
  })

  function schedule() {
    if (frame) {
      return
    }

    frame = requestAnimationFrame(() => {
      frame = 0

      if (element.isConnected) {
        render(getTheme())
      }
    })
  }

  return {
    connect: () => {
      observer.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      })
      stopThemeListener ??= onThemeChange(() => {
        schedule()
      })
      render(getTheme())
    },
    disconnect: () => {
      observer.disconnect()
      stopThemeListener?.()
      stopThemeListener = null

      if (frame) {
        cancelAnimationFrame(frame)
      }

      frame = 0
    },
    refresh: schedule,
  }
}
