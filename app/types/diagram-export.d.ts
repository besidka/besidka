import type { DiagramExportAction } from '@besidka/artifacts-protocol'

export type { DiagramExportAction }

export type DiagramExportOutcome = boolean | 'reported'

export interface DiagramExportInput {
  source: string
  svg: string
  themeElement: HTMLElement
}

export interface DiagramMenuAction {
  action: DiagramExportAction
  label: string
  icon: string
  needsSvg: boolean
}

export interface DiagramMenuInput {
  source: string
  svg: string
  themeElement: () => HTMLElement | null
}

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
