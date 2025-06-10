export const messagesStateName = 'messages'

export type MessageType = 'error' | 'success' | 'info' | 'warning'

export interface Message {
  type?: MessageType
  text: string
}

export interface MessageWithId extends Message {
  id: number
}
