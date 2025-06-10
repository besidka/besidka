import type { Confirmation, ConfirmationCallback } from '~/types/confirmation.d'

export const useConfirmation = () => {
  return useState<Confirmation | null>('confirmation', () => null)
}

export const useConfirmationModal = (
  callback: ConfirmationCallback,
  args: any[] = [],
  text: string = '',
  alert: boolean = false,
) => {
  const confirmation = useConfirmation()

  if (confirmation.value) {
    return
  }

  confirmation.value = {
    text: text ?? 'Confirm',
    callback,
    args,
    alert,
  }
}
