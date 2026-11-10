import type { Theme } from '@besidka/artifacts-protocol'
import { paletteDeclarations } from '../palette.ts'
import { getTheme, onThemeChange } from '../theme.ts'
import type { HostActionOutcome } from './host-actions.ts'

export type IconName
  = | 'copy'
    | 'check'
    | 'x'
    | 'fullscreen'
    | 'expand'
    | 'collapse'
    | 'download'
    | 'code'
    | 'file-text'
    | 'file-code'
    | 'workflow'
    | 'image'

export const FEEDBACK_DURATION_MS = 2_000

const ICON_PATHS: Record<IconName, string> = {
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'fullscreen': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'expand': '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'collapse': '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  'code': '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'file-code': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>',
  'workflow': '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
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
.dropdown {
  position: relative;
  display: inline-flex;
}
.dropdown-panel {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 50;
  width: 11rem;
  padding-top: 0.5rem;
}
.dropdown-panel[hidden] {
  display: none;
}
.dropdown-panel[data-placement='top'] {
  top: auto;
  bottom: 100%;
  padding-top: 0;
  padding-bottom: 0.5rem;
}
.dropdown-list {
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  background: var(--besidka-bg);
  border-radius: 0.5rem;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1), 0 0 0 1px color-mix(in srgb, var(--besidka-fg) 8%, transparent);
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  height: auto;
  padding: 0.25rem 0.625rem;
  color: color-mix(in srgb, var(--besidka-fg) 80%, transparent);
  font-size: 12px;
  font-weight: 400;
  line-height: 28px;
  text-align: start;
  border-radius: 2rem;
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
  --pele-bg: var(--besidka-bg);
  --pele-fg: var(--besidka-fg);
  --pele-muted: var(--besidka-muted);
  --pele-line: var(--besidka-fg);
  --pele-surface: var(--besidka-surface);
  --pele-surface-alt: color-mix(in srgb, var(--besidka-fg) 14%, var(--besidka-bg));
  --pele-border: color-mix(in srgb, var(--besidka-fg) 55%, var(--besidka-bg));
  --pele-accent: var(--besidka-accent);
  --pele-critical: var(--besidka-danger);
  --pele-error: var(--besidka-danger);
  --pele-font: 'Nunito', sans-serif;
  --pele-font-mono: 'Atkinson Hyperlegible Mono', monospace;
  --pele-series-1: #be185d;
  --pele-series-2: #0369a1;
  --pele-series-3: #047857;
  --pele-series-4: #b45309;
  --pele-series-5: #b91c1c;
  --pele-series-6: var(--besidka-fg);
  --pele-series-7: color-mix(in srgb, #be185d 50%, #0369a1);
  --pele-series-8: color-mix(in srgb, #047857 50%, #b45309);
  display: flex;
  justify-content: center;
  cursor: zoom-in;
}
.block[data-theme='dark'] .diagram {
  --pele-series-1: #f9a8d4;
  --pele-series-2: #38bdf8;
  --pele-series-3: #6ee7b7;
  --pele-series-4: #fcd34d;
  --pele-series-5: #f87171;
  --pele-series-7: #a78bfa;
  --pele-series-8: #a3e635;
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
  icon: IconName
}

export interface KitMenu {
  trigger: KitButton
  element: HTMLDivElement
  panel: HTMLDivElement
  close: () => void
}

type FocusTarget = 'first' | 'last' | 'next' | 'previous'

const MENU_ITEM_SELECTOR = '[role="menuitem"]'

const MENU_MOVES: Record<string, FocusTarget> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
}

let closeActiveMenu: (() => void) | null = null

const hostsWithReservedSpace = new WeakSet<HTMLElement>()

function releaseHostSpace(host: HTMLElement | undefined) {
  if (host && hostsWithReservedSpace.delete(host)) {
    host.style.removeProperty('padding-bottom')
  }
}

function findHost(element: HTMLElement): HTMLElement | undefined {
  const root = element.getRootNode()

  return root instanceof ShadowRoot ? root.host as HTMLElement : undefined
}

function focusItem(panel: HTMLElement, target: FocusTarget) {
  const items = Array.from(
    panel.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR),
  )

  if (items.length === 0) {
    return
  }

  const root = panel.getRootNode() as ShadowRoot | Document
  const current = items.findIndex((item) => {
    return item === root.activeElement
  })
  const lastIndex = items.length - 1
  const nextIndex = {
    first: 0,
    last: lastIndex,
    next: current >= lastIndex ? 0 : current + 1,
    previous: current <= 0 ? lastIndex : current - 1,
  }[target]

  items[nextIndex]?.focus()
}

/**
 * Keeps an open menu inside the frame. The panel opens below the button
 * like the chat's dropdown; when the frame's viewport would cut it off it
 * opens above if there is room, and otherwise the block's host grows by the
 * missing height until the menu closes, so the frame grows with it.
 */
function placePanel(panel: HTMLElement, trigger: HTMLElement) {
  const host = findHost(trigger)

  panel.dataset.placement = 'bottom'
  releaseHostSpace(host)

  const panelRect = panel.getBoundingClientRect()
  const missing = panelRect.bottom - window.innerHeight

  if (missing <= 0) {
    return
  }

  if (trigger.getBoundingClientRect().top - panelRect.height >= 0) {
    panel.dataset.placement = 'top'

    return
  }

  if (host) {
    hostsWithReservedSpace.add(host)
    host.style.setProperty('padding-bottom', `${Math.ceil(missing)}px`)
  }
}

/**
 * A toolbar button with a dropdown anchored under it, like the chat's
 * Copy and Download menus: `role="menu"`, opened by click, Enter, Space or
 * the arrow keys, moved with the arrows, Home and End, closed by Esc
 * (listened for on the document, because Safari does not focus a clicked
 * button), Tab, a pick or a pointer press anywhere else in the frame. One
 * menu is open at a time. The pointer check uses the composed path because
 * blocks live in shadow roots.
 */
export function createMenu<Action extends string>(
  testId: string,
  icon: IconName,
  text: string,
  items: KitMenuItem<Action>[],
  onSelect: (action: Action, event: MouseEvent) => void,
): KitMenu {
  const trigger = createButton(testId, icon, text)
  const element = document.createElement('div')
  const panel = document.createElement('div')
  const list = document.createElement('ul')

  element.className = 'dropdown'
  panel.className = 'dropdown-panel'
  panel.hidden = true
  panel.dataset.testid = `${testId}-menu`
  list.className = 'dropdown-list'
  list.setAttribute('role', 'menu')
  list.setAttribute('aria-label', text)
  trigger.element.setAttribute('aria-haspopup', 'menu')
  trigger.element.setAttribute('aria-expanded', 'false')

  function close(restoreFocus = false) {
    if (panel.hidden) {
      return
    }

    panel.hidden = true
    trigger.element.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeyDown, true)
    window.removeEventListener('blur', closeWithoutFocus)
    releaseHostSpace(findHost(trigger.element))

    if (closeActiveMenu === closeWithoutFocus) {
      closeActiveMenu = null
    }

    if (restoreFocus) {
      trigger.element.focus()
    }
  }

  function closeWithoutFocus() {
    close()
  }

  function onPointerDown(event: Event) {
    if (!event.composedPath().includes(element)) {
      close()
    }
  }

  function onDocumentKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    close(true)
  }

  function open(target: FocusTarget | null) {
    closeActiveMenu?.()
    panel.hidden = false
    trigger.element.setAttribute('aria-expanded', 'true')
    placePanel(panel, trigger.element)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)
    window.addEventListener('blur', closeWithoutFocus)
    closeActiveMenu = closeWithoutFocus

    if (target) {
      focusItem(panel, target)
    }
  }

  for (const item of items) {
    const entry = document.createElement('li')
    const option = document.createElement('button')
    const label = document.createElement('span')

    entry.setAttribute('role', 'none')
    option.type = 'button'
    option.className = 'dropdown-item'
    option.tabIndex = -1
    option.setAttribute('role', 'menuitem')
    option.dataset.testid = `${testId}-${item.action}`
    label.textContent = item.label
    option.append(createIcon(item.icon), label)
    option.addEventListener('click', (event) => {
      close(true)
      onSelect(item.action, event)
    })
    entry.append(option)
    list.append(entry)
  }

  trigger.element.addEventListener('click', (event) => {
    if (!panel.hidden) {
      close()

      return
    }

    open(event.detail === 0 ? 'first' : null)
  })

  trigger.element.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      open(event.key === 'ArrowDown' ? 'first' : 'last')
    }
  })

  panel.addEventListener('keydown', (event) => {
    const move = MENU_MOVES[event.key]

    if (move) {
      event.preventDefault()
      focusItem(panel, move)

      return
    }

    if (event.key === 'Tab') {
      close(true)
    }
  })

  panel.append(list)
  element.append(trigger.element, panel)

  return { trigger, element, panel, close: closeWithoutFocus }
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
