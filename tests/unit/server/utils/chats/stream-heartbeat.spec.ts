import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_STREAM_HEARTBEAT_INTERVAL_MS,
} from '#shared/utils/chat-stream-heartbeat'
import { startStreamHeartbeat } from '~~/server/utils/chats/stream-heartbeat'

describe('startStreamHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a transient heartbeat on every interval until stopped', () => {
    const write = vi.fn()
    const heartbeat = startStreamHeartbeat(write, { now: () => 42 })

    vi.advanceTimersByTime(CHAT_STREAM_HEARTBEAT_INTERVAL_MS * 2)

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledWith({
      type: 'data-heartbeat',
      data: { at: 42 },
      transient: true,
    })

    heartbeat.stop()
    vi.advanceTimersByTime(CHAT_STREAM_HEARTBEAT_INTERVAL_MS * 2)

    expect(write).toHaveBeenCalledTimes(2)
  })

  it('stops by itself once a write throws', () => {
    const write = vi.fn(() => {
      throw new Error('closed')
    })

    startStreamHeartbeat(write)
    vi.advanceTimersByTime(CHAT_STREAM_HEARTBEAT_INTERVAL_MS * 3)

    expect(write).toHaveBeenCalledTimes(1)
  })
})
