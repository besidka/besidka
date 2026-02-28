import type { ConfirmOptions, ConfirmResult } from '~/types/confirmation.d'

interface QueueEntry {
  options: ConfirmOptions
  resolve: (result: ConfirmResult | null) => void
}

const queue: QueueEntry[] = []

export const useConfirmation = () => {
  return useState<ConfirmOptions | null>('confirmation', () => null)
}

export async function useConfirm(
  options: ConfirmOptions,
): Promise<ConfirmResult | null> {
  const current = useConfirmation()

  return new Promise((resolve) => {
    queue.push({ options, resolve })

    if (!current.value) {
      current.value = queue[0]!.options
    }
  })
}

export function resolveConfirmation(result: ConfirmResult | null) {
  if (queue.length === 0) return

  const current = useConfirmation()
  const entry = queue.shift()!

  current.value = null
  entry.resolve(result)

  nextTick(() => {
    if (queue.length > 0) {
      current.value = queue[0]!.options
    }
  })
}

export function resetConfirmationState() {
  for (const entry of queue) {
    entry.resolve(null)
  }

  queue.splice(0)
  useConfirmation().value = null
}
