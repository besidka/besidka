import mermaid from 'mermaid'
import { MERMAID_ELEMENT_NAME } from '../kit/elements.ts'
import { createMermaidConfig } from './mermaid-config.ts'
import type { Renderer } from './types.ts'

type MermaidConfig = Parameters<typeof mermaid.initialize>[0]

/**
 * Validates the diagram first, so a syntax error still reaches the host as
 * an artifact error, then renders it through `<besidka-mermaid>` for the
 * same Copy and Fullscreen buttons as a diagram inside other artifacts.
 */
export const renderMermaid: Renderer = async (payload, context) => {
  mermaid.initialize(createMermaidConfig(context.theme) as MermaidConfig)
  await mermaid.parse(payload.content)

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
