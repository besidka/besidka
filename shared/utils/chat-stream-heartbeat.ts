export const CHAT_STREAM_HEARTBEAT_PART_TYPE = 'data-heartbeat'
export const CHAT_STREAM_HEARTBEAT_INTERVAL_MS = 15_000

/**
 * A transient chunk the send route writes while the Worker serving the
 * reply is alive, also while a tool runs or the provider is silent, so the
 * client can tell a slow step from a dead stream. Never stored in
 * `messages.parts`.
 */
export interface ChatStreamHeartbeatData {
  at: number
}
