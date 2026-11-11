export type DocumentRenderFailureCode
  = | 'spec_invalid'
    | 'asset_invalid'
    | 'bounds_exceeded'
    | 'font_unavailable'
    | 'render_failed'
    | 'validation_failed'
    | 'provenance_missing'
    | 'worker_error'
    | 'timeout'

export interface DocumentRenderStats {
  pages?: number
  slides?: number
  sheets?: number
  cells?: number
}

export interface DocumentWorkerAsset {
  id: string
  bytes: ArrayBuffer
  mediaType: string
}

export interface DocumentWorkerRequest {
  id: number
  spec: unknown
  assets: DocumentWorkerAsset[]
  modelId?: string
}

export interface DocumentWorkerSuccess {
  id: number
  ok: true
  bytes: ArrayBuffer
  mediaType: string
  stats: DocumentRenderStats
}

export interface DocumentWorkerFailure {
  id: number
  ok: false
  code: DocumentRenderFailureCode
  detail: string
}

export type DocumentWorkerResponse
  = | DocumentWorkerSuccess
    | DocumentWorkerFailure

export interface DocumentRenderAssetInput {
  id: string
  bytes: Uint8Array
  mediaType: string
}

export interface DocumentRenderInput {
  spec: unknown
  assets?: DocumentRenderAssetInput[]
  modelId?: string
}

export interface DocumentRenderOutput {
  bytes: Uint8Array
  mediaType: string
  stats: DocumentRenderStats
}
