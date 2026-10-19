export interface DiagramRenderError {
  message: string
  line?: number
  column?: number
}

export type DiagramRenderResult
  = | { svg: string }
    | { error: DiagramRenderError }

export interface DiagramRenderOptions {
  idPrefix?: string
  maxWidth?: number
}
