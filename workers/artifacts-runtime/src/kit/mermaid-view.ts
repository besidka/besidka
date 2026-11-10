import {
  DIAGRAM_COPY_MENU_ITEMS,
  DIAGRAM_DOWNLOAD_MENU_ITEMS,
  IMAGE_COPY_ACTION,
  describeDiagramLimit,
  detectMermaidLimit,
  isImageClipboardSupported,
} from '@besidka/artifacts-protocol'
import type {
  DiagramExportAction,
  Theme,
} from '@besidka/artifacts-protocol'
import { DiagramLimitError } from '../render/diagram-limit.ts'
import { renderDiagramSvg } from '../render/diagram.ts'
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

const FULLSCREEN_LABELS = {
  idleIcon: 'fullscreen',
  idle: 'Fullscreen',
  done: 'Fullscreen',
  failed: 'Unavailable',
} as const

function measureContentWidth(body: HTMLElement): number | undefined {
  const style = getComputedStyle(body)
  const padding = Number.parseFloat(style.paddingLeft)
    + Number.parseFloat(style.paddingRight)
  const width = body.clientWidth - (Number.isNaN(padding) ? 0 : padding)

  return width > 0 ? width : undefined
}

function toMenuItems(items: readonly KitMenuItem<DiagramExportAction>[]) {
  return items.filter((item) => {
    return item.action !== IMAGE_COPY_ACTION || isImageClipboardSupported()
  })
}

function describeError(exception: unknown): string {
  if (exception instanceof DiagramLimitError) {
    return exception.message
  }

  const message = exception instanceof Error
    ? exception.message
    : String(exception)

  const shortened = message.length > ERROR_MESSAGE_LIMIT
    ? `${message.slice(0, ERROR_MESSAGE_LIMIT)}…`
    : message

  return `Couldn't render diagram: ${shortened}`
}

/**
 * Renders `<besidka-mermaid>` like the chat's diagram block: the same Pele
 * renderer and options, themed from the host, with the chat's actions:
 * Fullscreen asks the host to open its own zoomable viewer, Download (SVG,
 * PNG, draw.io) and Copy (code, Markdown, SVG, PNG, draw.io) ask the host to
 * build and save or copy the file, since the sandboxed frame can neither
 * download nor reach the clipboard on its own.
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
  let renderedWidth: number | undefined

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
    toMenuItems(DIAGRAM_DOWNLOAD_MENU_ITEMS),
    (action, event) => {
      select(downloadMenu.trigger, DOWNLOAD_LABELS, action, event)
    },
  )
  const copyMenu = createMenu(
    'besidka-mermaid-copy',
    'copy',
    'Copy',
    toMenuItems(DIAGRAM_COPY_MENU_ITEMS),
    (action, event) => {
      select(copyMenu.trigger, COPY_LABELS, action, event)
    },
  )

  shell.actions.append(
    fullscreenButton.element,
    downloadMenu.element,
    copyMenu.element,
  )

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

    const sizeLimit = detectMermaidLimit('', source)

    if (sizeLimit) {
      showSource(describeDiagramLimit(sizeLimit))

      return
    }

    try {
      const width = measureContentWidth(shell.body)
      const svg = await renderDiagramSvg(source, width)

      if (sequence !== renderSequence) {
        return
      }

      renderedWidth = width
      diagram.innerHTML = svg
      diagram.dataset.theme = theme
      shell.body.replaceChildren(diagram)
      error.hidden = true
      fullscreenButton.element.disabled = false
      rendered = true
    } catch (exception) {
      if (sequence === renderSequence) {
        showSource(describeError(exception))
      }
    }
  }

  const loop = createRenderLoop(element, (theme) => {
    render(theme)
  })
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => {
      const width = measureContentWidth(shell.body)

      if (rendered && Math.abs((width ?? 0) - (renderedWidth ?? 0)) > 1) {
        loop.refresh()
      }
    })

  return {
    connect: () => {
      loop.connect()
      resizeObserver?.observe(shell.body)
    },
    disconnect: () => {
      loop.disconnect()
      resizeObserver?.disconnect()
    },
    refresh: loop.refresh,
  }
}
