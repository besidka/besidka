import { describeDiagramLimit } from '@besidka/artifacts-protocol'
import type { DiagramLimit } from '@besidka/artifacts-protocol'

export class DiagramLimitError extends Error {
  readonly diagramLimit: DiagramLimit
  readonly rawMessage: string

  constructor(diagramLimit: DiagramLimit, rawMessage: string) {
    super(describeDiagramLimit(diagramLimit))
    this.name = 'DiagramLimitError'
    this.diagramLimit = diagramLimit
    this.rawMessage = rawMessage
  }
}
