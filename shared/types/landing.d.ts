export type StatMetric
  = | 'users'
    | 'chats'
    | 'messages'
    | 'files'
    | 'uploadedFiles'
    | 'generatedImages'
    | 'sharedChats'

export interface ComparisonRow {
  label: string
  values: string[]
}

export interface ComparisonData {
  caption?: string
  columns: string[]
  rows: ComparisonRow[]
  note?: string
  priceDate?: string
}
