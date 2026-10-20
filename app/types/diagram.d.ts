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

export interface DiagramFontDescriptor {
  family: string
  src: string
  weight?: string
  style?: string
  unicodeRange?: string
}

export interface DiagramCodePointRange {
  start: number
  end: number
}

export interface DiagramWorkerRequest {
  id: number
  source: string
  options: { maxWidth?: number }
  fonts: DiagramFontDescriptor[]
}

export type DiagramWorkerResponse
  = | { id: number, status: 'ready' }
    | { id: number, svg: string }
    | { id: number, error: DiagramRenderError }
