import {
  CHAT_STREAM_HEARTBEAT_INTERVAL_MS,
  CHAT_STREAM_HEARTBEAT_PART_TYPE,
} from '#shared/utils/chat-stream-heartbeat'
import type { ChatStreamHeartbeatData } from '#shared/utils/chat-stream-heartbeat'

export interface StreamHeartbeatChunk {
  type: typeof CHAT_STREAM_HEARTBEAT_PART_TYPE
  data: ChatStreamHeartbeatData
  transient: true
}

export interface StreamHeartbeat {
  stop: () => void
}

/**
 * Writes a transient `data-heartbeat` chunk every
 * `CHAT_STREAM_HEARTBEAT_INTERVAL_MS` until stopped. A write that throws
 * (the stream already closed) stops the heartbeat.
 */
export function startStreamHeartbeat(
  write: (chunk: StreamHeartbeatChunk) => void,
  options: { intervalMs?: number, now?: () => number } = {},
): StreamHeartbeat {
  const now = options.now ?? Date.now
  const timer = setInterval(() => {
    try {
      write({
        type: CHAT_STREAM_HEARTBEAT_PART_TYPE,
        data: { at: now() },
        transient: true,
      })
    } catch {
      clearInterval(timer)
    }
  }, options.intervalMs ?? CHAT_STREAM_HEARTBEAT_INTERVAL_MS)

  return {
    stop: () => clearInterval(timer),
  }
}
