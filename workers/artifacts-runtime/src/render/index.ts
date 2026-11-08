import type { ArtifactKind } from '@besidka/artifacts-protocol'
import type { Renderer } from './types.ts'

export type DocumentStrategy = 'replace-document' | 'shell'

export interface RendererDefinition {
  strategy: DocumentStrategy
  load: () => Promise<Renderer>
}

export const RENDERERS: Record<ArtifactKind, RendererDefinition> = {
  html: {
    strategy: 'replace-document',
    load: async () => {
      throw new Error('HTML artifacts replace the document')
    },
  },
  react: {
    strategy: 'shell',
    load: async () => {
      const module = await import('./react.ts')

      return module.renderReact
    },
  },
  svg: {
    strategy: 'shell',
    load: async () => {
      const module = await import('./svg.ts')

      return module.renderSvg
    },
  },
  mermaid: {
    strategy: 'shell',
    load: async () => {
      const module = await import('./mermaid.ts')

      return module.renderMermaid
    },
  },
  markdown: {
    strategy: 'shell',
    load: async () => {
      const module = await import('./markdown.ts')

      return module.renderMarkdown
    },
  },
}

export function selectRenderer(kind: ArtifactKind): RendererDefinition {
  return RENDERERS[kind]
}
