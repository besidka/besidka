import type { Message, MessageWithId, MessageType } from '~/types/message.d'
import { messagesStateName } from '~/types/message.d'

export const useMessages = () => {
  return useState<MessageWithId[]>(messagesStateName, () => [])
}

const addMessage = (message: Message) => {
  const messages = useMessages()

  messages.value = [
    {
      ...message,
      id: Date.now(),
    },
    ...messages.value,
  ]
}

export const useErrorMessage = (text: string = '') => {
  addMessage({
    text: text || 'Something went wrong',
    type: 'error' as MessageType,
  })
}

export const useSuccessMessage = (text: string) => {
  addMessage({
    text,
    type: 'success' as MessageType,
  })
}

export const useInfoMessage = (text: string) => {
  addMessage({
    text,
    type: 'info' as MessageType,
  })
}

export const useWarningMessage = (text: string) => {
  addMessage({
    text,
    type: 'warning' as MessageType,
  })
}
