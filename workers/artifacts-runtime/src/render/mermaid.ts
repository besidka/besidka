import { MERMAID_ELEMENT_NAME } from '../kit/elements.ts'
import { DiagramLimitError } from './diagram-limit.ts'
import { renderDiagramSvg } from './diagram.ts'
import type { Renderer } from './types.ts'

const LIMIT_PLACEHOLDER_TEXT = 'This diagram is too large to draw.'

function showLimitPlaceholder(root: HTMLElement) {
  const placeholder = document.createElement('p')

  placeholder.className = 'besidka-diagram-limit'
  placeholder.dataset.testid = 'besidka-diagram-limit'
  placeholder.textContent = LIMIT_PLACEHOLDER_TEXT
  root.replaceChildren(placeholder)
}

/**
 * Renders the diagram once before showing it, so a syntax error still
 * reaches the host as an artifact error (the panel's Ask to fix works) and a
 * source over the shared limits becomes a `DiagramLimitError`. The diagram is
 * then drawn by `<besidka-mermaid>`, which has the chat's Copy, Download and
 * Fullscreen actions and renders with the same options as the chat.
 */
export const renderMermaid: Renderer = async (payload, context) => {
  try {
    await renderDiagramSvg(payload.content, undefined)
  } catch (exception) {
    if (exception instanceof DiagramLimitError && context.isCurrent()) {
      showLimitPlaceholder(context.root)
    }

    throw exception
  }

  if (!context.isCurrent()) {
    return
  }

  const container = document.createElement('main')
  const diagram = document.createElement(MERMAID_ELEMENT_NAME)

  container.className = 'besidka-mermaid'
  diagram.textContent = payload.content
  container.append(diagram)
  context.root.replaceChildren(container)
}
