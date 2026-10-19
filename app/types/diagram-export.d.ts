export interface DiagramExportInput {
  source: string
  svg: string
  themeElement: HTMLElement
}

export type DiagramExportAction
  = | 'copy-svg'
    | 'copy-markdown'
    | 'copy-drawio'
    | 'download-svg'
    | 'download-png'
    | 'download-drawio'
    | 'open-drawio'

export interface DiagramPngOptions {
  scale?: number
  maxPixels?: number
}

export interface DiagramSvgDimensions {
  width: number
  height: number
}

export interface DiagramEmbeddedFontFace {
  family: string
  weight: string
  dataUrl: string
  format: string
}

export type DiagramVariableResolver = (name: string) => string | undefined
