import { detectMermaidLimit } from '@besidka/artifacts-protocol'
import mermaid from 'mermaid'
import { MERMAID_ELEMENT_NAME } from '../kit/elements.ts'
import { DiagramLimitError } from './diagram-limit.ts'
import { createMermaidConfig } from './mermaid-config.ts'
import type { Renderer } from './types.ts'

type MermaidConfig = Parameters<typeof mermaid.initialize>[0]

const LIMIT_PLACEHOLDER_TEXT = 'This diagram is too large to draw.'

function showLimitPlaceholder(root: HTMLElement) {
  const placeholder = document.createElement('p')

  placeholder.className = 'besidka-diagram-limit'
  placeholder.dataset.testid = 'besidka-diagram-limit'
  placeholder.textContent = LIMIT_PLACEHOLDER_TEXT
  root.replaceChildren(placeholder)
}

/**
 * Mermaid's `render` swaps an oversized source for a stub diagram without an
 * error, and `parse` reports the edge limit with a developer message the
 * reader cannot act on, so both are turned into a `DiagramLimitError`.
 */
async function parseWithinLimits(source: string) {
  const sizeLimit = detectMermaidLimit('', source)

  if (sizeLimit) {
    throw new DiagramLimitError(
      sizeLimit,
      `Diagram source is ${source.length} characters.`,
    )
  }

  try {
    await mermaid.parse(source)
  } catch (exception) {
    const message = exception instanceof Error
      ? exception.message
      : String(exception)
    const edgeLimit = detectMermaidLimit(message, source)

    if (edgeLimit) {
      throw new DiagramLimitError(edgeLimit, message)
    }

    throw exception
  }
}

/**
 * Validates the diagram first, so a syntax error still reaches the host as
 * an artifact error, then renders it through `<besidka-mermaid>` for the
 * same Copy and Fullscreen buttons as a diagram inside other artifacts.
 */
export const renderMermaid: Renderer = async (payload, context) => {
  mermaid.initialize(createMermaidConfig(context.theme) as MermaidConfig)

  try {
    await parseWithinLimits(payload.content)
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
