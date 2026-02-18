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

export const useErrorMessage = (title: string = '', description?: string) => {
  addMessage({
    title: title || 'Something went wrong',
    description,
    type: 'error' as MessageType,
  })
}

export const useSuccessMessage = (
  title: string,
  description?: string,
) => {
  addMessage({
    title,
    description,
    type: 'success' as MessageType,
  })
}

export const useInfoMessage = (title: string, description?: string) => {
  addMessage({
    title,
    description,
    type: 'info' as MessageType,
  })
}

export const useWarningMessage = (
  title: string,
  description?: string,
) => {
  addMessage({
    title,
    description,
    type: 'warning' as MessageType,
  })
}
