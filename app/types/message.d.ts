export const messagesStateName = 'messages'

export type MessageType = 'error' | 'success' | 'info' | 'warning'

export interface Message {
  type?: MessageType
  title: string
  description?: string
  // Legacy support for old text-only messages
  text?: string
}

export interface MessageWithId extends Message {
  id: number
}
