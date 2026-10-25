/**
 * Bounds for one project-memory refresh. Each summarized chat costs one
 * sequential LLM call, so `maxChatsSummarizedPerRefresh` keeps a refresh well
 * inside a single request. `maxMemoryChars` is injected into every chat turn
 * of the project, so it stays small.
 */
export const PROJECT_MEMORY_LIMITS = {
  maxChatsConsidered: 20,
  maxChatsSummarizedPerRefresh: 6,
  maxTranscriptMessages: 60,
  maxTranscriptChars: 12_000,
  maxUserMessageChars: 3_000,
  maxAssistantMessageChars: 1_000,
  maxSummaryChars: 1_500,
  maxMemoryChars: 4_000,
} as const
