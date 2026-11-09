import {
  describeDiagramLimit,
  detectMermaidLimit,
} from '@besidka/artifacts-protocol'
import type {
  DiagramExportAction,
  Theme,
} from '@besidka/artifacts-protocol'
import mermaid from 'mermaid'
import { createMermaidConfig } from '../render/mermaid-config.ts'
import {
  createButton,
  createMenu,
  createRenderLoop,
  createShell,
  readSource,
  showOutcome,
} from './chrome.ts'
import type { KitButton, KitController, KitMenuItem } from './chrome.ts'
import {
  copyThroughHost,
  exportDiagramThroughHost,
  openDiagramViewerThroughHost,
} from './host-actions.ts'
import type { HostActionOutcome } from './host-actions.ts'

type MermaidConfig = Parameters<typeof mermaid.initialize>[0]

const ERROR_MESSAGE_LIMIT = 200

const NOT_RENDERED_MESSAGE = 'The diagram has not rendered.'

const COPY_LABELS = {
  idleIcon: 'copy',
  idle: 'Copy',
  done: 'Copied!',
  failed: 'Copy failed',
} as const

const DOWNLOAD_LABELS = {
  idleIcon: 'download',
  idle: 'Download',
  done: 'Downloaded',
  failed: 'Download failed',
} as const

const DOWNLOAD_ITEMS: KitMenuItem<DiagramExportAction>[] = [
  { action: 'download-svg', label: 'SVG' },
  { action: 'download-png', label: 'PNG' },
  { action: 'download-drawio', label: '.drawio' },
]

const COPY_ITEMS: KitMenuItem<DiagramExportAction>[] = [
  { action: 'copy-source', label: 'Code' },
  { action: 'copy-markdown', label: 'Markdown' },
  { action: 'copy-svg', label: 'SVG' },
  { action: 'copy-drawio', label: 'draw.io' },
]

const FULLSCREEN_LABELS = {
  idleIcon: 'fullscreen',
  idle: 'Fullscreen',
  done: 'Fullscreen',
  failed: 'Unavailable',
} as const

let diagramCount = 0
let renderQueue: Promise<unknown> = Promise.resolve()

function renderDiagram(source: string, theme: Theme): Promise<string> {
  const task = renderQueue.then(async () => {
    diagramCount += 1

    const id = `besidka-kit-mermaid-${diagramCount}`

    mermaid.initialize(createMermaidConfig(theme) as MermaidConfig)

    try {
      if (detectMermaidLimit('', source)) {
        throw new Error('Maximum text size exceeded')
      }

      const { svg } = await mermaid.render(id, source)

      return svg
    } finally {
      document.getElementById(`d${id}`)?.remove()
    }
  })

  renderQueue = task.catch(() => {})

  return task
}

function describeError(exception: unknown, source: string): string {
  const message = exception instanceof Error
    ? exception.message
    : String(exception)
  const diagramLimit = detectMermaidLimit(message, source)

  if (diagramLimit) {
    return describeDiagramLimit(diagramLimit)
  }

  const shortened = message.length > ERROR_MESSAGE_LIMIT
    ? `${message.slice(0, ERROR_MESSAGE_LIMIT)}…`
    : message

  return `Couldn't render diagram: ${shortened}`
}

/**
 * Renders `<besidka-mermaid>` like the chat's diagram block: the vendored
 * Mermaid (dagre layout, strict security) themed from the host, with the
 * chat's actions: Fullscreen asks the host to open its own zoomable viewer,
 * Download (SVG, PNG, draw.io) and Copy (code, Markdown, SVG, draw.io) ask
 * the host to build and save or copy the file, since the sandboxed frame
 * can neither download nor reach the clipboard on its own.
 */
export function createMermaidController(element: HTMLElement): KitController {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
  const shell = createShell(root, 'mermaid')
  const fullscreenButton = createButton(
    'besidka-mermaid-fullscreen',
    'fullscreen',
    'Fullscreen',
  )
  const diagram = document.createElement('div')
  const error = document.createElement('p')
  let source = ''
  let rendered = false
  let renderSequence = 0

  shell.block.dataset.testid = 'besidka-mermaid'
  diagram.className = 'diagram'
  diagram.dataset.testid = 'besidka-mermaid-diagram'
  error.className = 'error'
  error.dataset.testid = 'besidka-mermaid-error'
  error.hidden = true
  fullscreenButton.element.disabled = true
  shell.block.append(error)

  async function openViewer(event: Event) {
    if (!rendered) {
      return
    }

    const outcome = await openDiagramViewerThroughHost(source, event)

    if (!outcome.ok) {
      showOutcome(fullscreenButton, outcome, FULLSCREEN_LABELS)
    }
  }

  fullscreenButton.element.addEventListener('click', openViewer)
  diagram.addEventListener('click', openViewer)
  async function runExport(
    action: DiagramExportAction,
    event: Event,
  ): Promise<HostActionOutcome> {
    if (action === 'copy-source') {
      return copyThroughHost(source, event)
    }

    if (!rendered) {
      return { ok: false, message: NOT_RENDERED_MESSAGE }
    }

    return exportDiagramThroughHost(source, action, event)
  }

  async function select(
    button: KitButton,
    labels: typeof COPY_LABELS | typeof DOWNLOAD_LABELS,
    action: DiagramExportAction,
    event: Event,
  ) {
    showOutcome(button, await runExport(action, event), labels)
  }

  const downloadMenu = createMenu(
    'besidka-mermaid-download',
    'download',
    'Download',
    DOWNLOAD_ITEMS,
    (action, event) => {
      select(downloadMenu.trigger, DOWNLOAD_LABELS, action, event)
    },
  )
  const copyMenu = createMenu(
    'besidka-mermaid-copy',
    'copy',
    'Copy',
    COPY_ITEMS,
    (action, event) => {
      select(copyMenu.trigger, COPY_LABELS, action, event)
    },
  )

  shell.actions.append(
    fullscreenButton.element,
    downloadMenu.trigger.element,
    copyMenu.trigger.element,
  )
  shell.body.before(downloadMenu.panel, copyMenu.panel)

  function showSource(message: string) {
    const pre = document.createElement('pre')

    pre.textContent = source
    shell.body.replaceChildren(pre)
    error.textContent = message
    error.hidden = false
    fullscreenButton.element.disabled = true
    rendered = false
  }

  async function render(theme: Theme) {
    const sequence = ++renderSequence

    source = readSource(element)
    shell.setTheme(theme)

    if (!source) {
      showSource('Couldn\'t render diagram: the diagram is empty')

      return
    }

    try {
      const svg = await renderDiagram(source, theme)

      if (sequence !== renderSequence) {
        return
      }

      diagram.innerHTML = svg
      diagram.dataset.theme = theme
      shell.body.replaceChildren(diagram)
      error.hidden = true
      fullscreenButton.element.disabled = false
      rendered = true
    } catch (exception) {
      if (sequence === renderSequence) {
        showSource(describeError(exception, source))
      }
    }
  }

  return createRenderLoop(element, (theme) => {
    render(theme)
  })
}
