import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import {
  useConfirmation,
  useConfirm,
  resolveConfirmation,
  resetConfirmationState,
} from '../../../app/composables/confirmation'

describe('useConfirm / resolveConfirmation', () => {
  beforeEach(() => {
    resetConfirmationState()
  })

  it('sets confirmation state with provided options', () => {
    useConfirm({ text: 'Delete this item?', actions: ['Confirm'] })

    expect(useConfirmation().value?.text).toBe('Delete this item?')
    expect(useConfirmation().value?.actions).toEqual(['Confirm'])
  })

  it('applies alert and subtitle options', () => {
    useConfirm({
      text: 'Confirm',
      alert: true,
      subtitle: 'This cannot be undone.',
      actions: ['Confirm'],
    })

    expect(useConfirmation().value?.alert).toBe(true)
    expect(useConfirmation().value?.subtitle).toBe('This cannot be undone.')
  })

  it('stores labelDecline option', () => {
    useConfirm({ text: 'Confirm', actions: ['OK'], labelDecline: 'Cancel' })

    expect(useConfirmation().value?.labelDecline).toBe('Cancel')
  })

  it('resolves with result when resolveConfirmation is called', async () => {
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })

    resolveConfirmation({ label: 'OK', index: 0 })

    expect(await promise).toEqual({ label: 'OK', index: 0 })
  })

  it('resolves with null when resolveConfirmation(null) is called', async () => {
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })

    resolveConfirmation(null)

    expect(await promise).toBeNull()
  })

  it('clears confirmation state after resolveConfirmation', async () => {
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })

    resolveConfirmation({ label: 'OK', index: 0 })
    await promise

    expect(useConfirmation().value).toBeNull()
  })

  it('resolves with the correct action index for multi-action confirmations', async () => {
    const promise = useConfirm({
      text: 'Open link?',
      actions: ['Open', 'Open always'],
    })

    resolveConfirmation({ label: 'Open always', index: 1 })

    expect(await promise).toEqual({ label: 'Open always', index: 1 })
  })

  it('queues a second call while first is pending', () => {
    useConfirm({ text: 'First', actions: ['OK'] })
    useConfirm({ text: 'Second', actions: ['OK'] })

    expect(useConfirmation().value?.text).toBe('First')
  })

  it('shows next queued confirmation after first resolves', async () => {
    const promise1 = useConfirm({ text: 'First', actions: ['OK'] })
    useConfirm({ text: 'Second', actions: ['OK'] })

    resolveConfirmation({ label: 'OK', index: 0 })
    await promise1
    await nextTick()

    expect(useConfirmation().value?.text).toBe('Second')
  })

  it('resolves queued confirmations in order', async () => {
    const promise1 = useConfirm({ text: 'First', actions: ['A'] })
    const promise2 = useConfirm({ text: 'Second', actions: ['B'] })

    resolveConfirmation({ label: 'A', index: 0 })
    const result1 = await promise1
    await nextTick()

    resolveConfirmation({ label: 'B', index: 0 })
    const result2 = await promise2

    expect(result1).toEqual({ label: 'A', index: 0 })
    expect(result2).toEqual({ label: 'B', index: 0 })
  })

  it('is a no-op when resolveConfirmation is called with empty queue', () => {
    expect(() => resolveConfirmation(null)).not.toThrow()
    expect(useConfirmation().value).toBeNull()
  })

  it('resetConfirmationState resolves all pending promises with null', async () => {
    const promise1 = useConfirm({ text: 'First', actions: ['OK'] })
    const promise2 = useConfirm({ text: 'Second', actions: ['OK'] })

    resetConfirmationState()

    expect(await promise1).toBeNull()
    expect(await promise2).toBeNull()
    expect(useConfirmation().value).toBeNull()
  })
})
