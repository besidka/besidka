export type ModelContextOmissionReason
  = | 'unsupported-by-model'
    | 'outside-window'
    | 'over-limit'
    | 'gateway-no-carry'

export interface ModelContextOmittedFile {
  filename?: string
  mediaType: string
  reason: ModelContextOmissionReason
}

export interface OmittedContextFilesData {
  modelName?: string
  files: ModelContextOmittedFile[]
}
