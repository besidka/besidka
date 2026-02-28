export interface ConfirmOptions {
  text?: string
  subtitle?: string
  alert?: boolean
  actions: string[]
  labelDecline?: string
}

export interface ConfirmResult {
  label: string
  index: number
}
