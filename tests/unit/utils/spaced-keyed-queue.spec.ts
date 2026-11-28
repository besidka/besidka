import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SAME_TARGET_SAVE_GAP_MS,
  createSpacedKeyedQueue,
} from '../../../app/utils/spaced-keyed-queue'

describe('createSpacedKeyedQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses a gap just above the KV write rate of one a second', () => {
    expect(SAME_TARGET_SAVE_GAP_MS).toBe(1100)
  })

  it('runs the first task of a key at once', async () => {
    const queue = createSpacedKeyedQueue()
    const task = vi.fn(async () => 'done')

    expect(await queue.enqueue('a', task)).toBe('done')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('starts the next task of a key only after the gap, in order',
    async () => {
      const queue = createSpacedKeyedQueue(1000)
      const order: string[] = []

      await queue.enqueue('a', async () => {
        order.push('first')
      })

      const second = queue.enqueue('a', async () => {
        order.push('second')
      })
      const third = queue.enqueue('a', async () => {
        order.push('third')
      })

      await vi.advanceTimersByTimeAsync(999)

      expect(order).toEqual(['first'])

      await vi.advanceTimersByTimeAsync(1)
      await second

      expect(order).toEqual(['first', 'second'])

      await vi.advanceTimersByTimeAsync(1000)
      await third

      expect(order).toEqual(['first', 'second', 'third'])
    })

  it('does not make different keys wait for each other', async () => {
    const queue = createSpacedKeyedQueue(1000)
    const order: string[] = []

    await queue.enqueue('a', async () => {
      order.push('a')
    })
    await queue.enqueue('b', async () => {
      order.push('b')
    })

    expect(order).toEqual(['a', 'b'])
  })

  it('counts the gap from the end of a failed task and runs the next',
    async () => {
      const queue = createSpacedKeyedQueue(1000)
      const next = vi.fn(async () => 'next')

      await expect(queue.enqueue('a', async () => {
        throw new Error('Nope')
      })).rejects.toThrow('Nope')

      const pending = queue.enqueue('a', next)

      await vi.advanceTimersByTimeAsync(999)

      expect(next).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)

      expect(await pending).toBe('next')
    })

  it('forgets earlier saves on reset', async () => {
    const queue = createSpacedKeyedQueue(1000)

    await queue.enqueue('a', async () => 1)
    queue.reset()

    expect(await queue.enqueue('a', async () => 2)).toBe(2)
  })
})
