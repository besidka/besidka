import type { CreatedVia } from '@besidka/doc-renderer/provenance'
import type {
  ImageMediaType,
  RenderStats,
} from '@besidka/doc-renderer/render'
import type { SpecIssue } from '@besidka/doc-renderer/spec'
import type {
  ValidatedFormat,
  ValidationResult,
} from '@besidka/doc-renderer/validate'

export type DocumentFormat = ValidatedFormat

export const CREATED_VIA_VALUES = [
  'chat',
  'mcp',
  'research',
  'code-execution',
] as const satisfies readonly CreatedVia[]

export type DocumentStats = RenderStats

export interface RenderAssetInput {
  fileId: string
  mediaType: ImageMediaType
  bytes: Uint8Array
}

export interface RenderRequest {
  specVersion: number
  spec: unknown
  assets: RenderAssetInput[]
  provenance: {
    model: string | null
    createdVia: CreatedVia
    aiGenerated?: boolean
  }
}

export type RenderFailureCode
  = | 'spec_invalid'
    | 'spec_version_unsupported'
    | 'bounds_exceeded'
    | 'asset_invalid'
    | 'render_failed'
    | 'output_invalid'

export interface RenderSuccess {
  ok: true
  bytes: Uint8Array
  mediaType: string
  extension: DocumentFormat
  stats: DocumentStats
  rendererVersion: string
}

export interface RenderFailure {
  ok: false
  code: RenderFailureCode
  detail?: string
  issues?: SpecIssue[]
}

export type RenderResult = RenderSuccess | RenderFailure

export interface ValidateRequest {
  format: DocumentFormat
  bytes: Uint8Array
  spec?: unknown
}

export type ValidateResult = ValidationResult

export interface RendererCapabilities {
  rendererVersion: string
  specVersions: number[]
  formats: string[]
  maxOutputBytes: number
}

export interface DocumentRendererService {
  capabilities: () => Promise<RendererCapabilities>
  render: (request: RenderRequest) => Promise<RenderResult>
  validate: (request: ValidateRequest) => Promise<ValidateResult>
}
