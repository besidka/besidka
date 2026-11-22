import type { ArtifactPayload, Theme } from '@besidka/artifacts-protocol'

export interface RenderContext {
  root: HTMLElement
  theme: Theme
  isCurrent: () => boolean
  partial?: boolean
}

export type Renderer = (
  payload: ArtifactPayload,
  context: RenderContext,
) => Promise<void> | void

export class ArtifactRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactRenderError'
  }
}
