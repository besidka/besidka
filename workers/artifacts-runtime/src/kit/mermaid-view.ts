import type { Theme } from '@besidka/artifacts-protocol'
import mermaid from 'mermaid'
import { createMermaidConfig } from '../render/mermaid-config.ts'
import {
  createButton,
  createRenderLoop,
  createShell,
  readSource,
  showOutcome,
} from './chrome.ts'
import type { KitController } from './chrome.ts'
import {
  copyThroughHost,
  openDiagramViewerThroughHost,
} from './host-actions.ts'

type MermaidConfig = Parameters<typeof mermaid.initialize>[0]

const ERROR_MESSAGE_LIMIT = 200

const COPY_LABELS = {
  idleIcon: 'copy',
  idle: 'Copy',
  done: 'Copied!',
  failed: 'Copy failed',
} as const

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
      const { svg } = await mermaid.render(id, source)

      return svg
    } finally {
      document.getElementById(`d${id}`)?.remove()
    }
  })

  renderQueue = task.catch(() => {})

  return task
}

function describeError(exception: unknown): string {
  const message = exception instanceof Error
    ? exception.message
    : String(exception)
  const shortened = message.length > ERROR_MESSAGE_LIMIT
    ? `${message.slice(0, ERROR_MESSAGE_LIMIT)}…`
    : message

  return `Couldn't render diagram: ${shortened}`
}

/**
 * Renders `<besidka-mermaid>` like the chat's diagram block: the vendored
 * Mermaid (dagre layout, strict security) themed from the host, Copy of the
 * source and Fullscreen, which asks the host to open its own diagram viewer
 * with the source (the frame itself cannot go full screen).
 */
export function createMermaidController(element: HTMLElement): KitController {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
  const shell = createShell(root, 'mermaid')
  const fullscreenButton = createButton(
    'besidka-mermaid-fullscreen',
    'fullscreen',
    'Fullscreen',
  )
  const copyButton = createButton('besidka-mermaid-copy', 'copy', 'Copy')
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
  copyButton.element.addEventListener('click', async (event) => {
    const outcome = await copyThroughHost(source, event)

    showOutcome(copyButton, outcome, COPY_LABELS)
  })
  shell.actions.append(fullscreenButton.element, copyButton.element)

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
        showSource(describeError(exception))
      }
    }
  }

  return createRenderLoop(element, (theme) => {
    render(theme)
  })
}
