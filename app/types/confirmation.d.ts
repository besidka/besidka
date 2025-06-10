export type ConfirmationCallback = (...args: any[]) => void | Promise<any>

export interface Confirmation {
  callback: ConfirmationCallback
  text: string
  args: any[]
  alert: boolean
}
