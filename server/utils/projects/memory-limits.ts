/**
 * Bounds shared by the memory extraction transcript and the explicit project
 * refresh. `maxChatsConsidered` caps how many of a project's most recently
 * active chats one refresh looks at; the message caps bound one chat message
 * inside an extraction transcript.
 */
export const PROJECT_MEMORY_LIMITS = {
  maxChatsConsidered: 20,
  maxUserMessageChars: 3_000,
  maxAssistantMessageChars: 1_000,
} as const
