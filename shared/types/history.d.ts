import type { Serialize } from 'nitropack/types'
import * as schema from '~~/server/db/schema'

type HistoryChatRow = Pick<
  typeof schema.chats.$inferSelect,
  'id'
  | 'slug'
  | 'title'
  | 'createdAt'
  | 'activityAt'
  | 'pinnedAt'
> & {
  projectId: typeof schema.chats.$inferSelect['projectId'] | null
  projectName: typeof schema.projects.$inferSelect['name'] | null
  shared: boolean
}

export type HistoryChat = Serialize<HistoryChatRow>

export interface HistoryResponse {
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
}

type SharedChatRow = HistoryChatRow & {
  shareSlug: typeof schema.chatShares.$inferSelect['slug']
  expiresAt: typeof schema.chatShares.$inferSelect['expiresAt']
  showAuthorAvatar: typeof schema.chatShares.$inferSelect['showAuthorAvatar']
  allowBranch: typeof schema.chatShares.$inferSelect['allowBranch']
}

export type SharedChat = Serialize<SharedChatRow>

export interface SharedChatsResponse {
  chats: SharedChat[]
  nextCursor: string | null
}
