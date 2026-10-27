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

export type KnowledgeNotice
  = | 'full-does-not-fit'
    | 'media-omitted'
    | 'unavailable'

export interface KnowledgeNoticeData {
  modelName?: string
  notice: KnowledgeNotice
}
