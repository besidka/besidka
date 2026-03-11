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
  folderId: typeof schema.chats.$inferSelect['folderId'] | null
  folderName: typeof schema.folders.$inferSelect['name'] | null
}

export type HistoryChat = Serialize<HistoryChatRow>

export interface HistoryResponse {
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
}
