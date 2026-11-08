import mermaid from 'mermaid'
import { createMermaidConfig } from './mermaid-config.ts'
import type { Renderer } from './types.ts'

type MermaidConfig = Parameters<typeof mermaid.initialize>[0]

let diagramCount = 0

export const renderMermaid: Renderer = async (payload, context) => {
  mermaid.initialize(createMermaidConfig(context.theme) as MermaidConfig)

  diagramCount += 1

  const { svg } = await mermaid.render(
    `besidka-mermaid-${diagramCount}`,
    payload.content,
  )

  if (!context.isCurrent()) {
    return
  }

  const container = document.createElement('main')

  container.className = 'besidka-mermaid'
  container.innerHTML = svg
  context.root.replaceChildren(container)
}
