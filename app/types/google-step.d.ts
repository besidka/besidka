export interface GoogleStepReference {
  id: string
  kind: string
  title: string
  link: string
  date: string
}

export interface GoogleStepReferenceLabel {
  text: string
  linkText: string
  linkLabel: string
}

export type GoogleStepState = 'working' | 'done' | 'failed'

export interface GoogleStepData {
  toolName: string
  state: GoogleStepState
  references: GoogleStepReference[]
}
