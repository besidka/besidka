import type { FileSource } from './files.d'

export type ImageGenerationProvider = 'openai' | 'google'

export type ImageGenerationAspectRatio
  = | '1:1'
    | '2:3'
    | '3:2'

export interface ImageGenerationProgress {
  status: 'generating' | 'saving'
}

export interface GeneratedImageFile {
  id: string
  storageKey: string
  name: string
  size: number
  type: string
  source: FileSource
  url: string
  downloadUrl: string
}

export interface ImageGenerationReady {
  status: 'ready'
  file: GeneratedImageFile
  provider: ImageGenerationProvider
  model: string
}

export type ImageGenerationToolOutput
  = | ImageGenerationProgress
    | ImageGenerationReady
