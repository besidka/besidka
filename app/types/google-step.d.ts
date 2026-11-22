export interface GoogleStepReference {
  id: string
  title: string
  link: string
  date: string
}

export type GoogleStepState = 'working' | 'done' | 'failed'

export interface GoogleStepData {
  toolName: string
  state: GoogleStepState
  references: GoogleStepReference[]
}
