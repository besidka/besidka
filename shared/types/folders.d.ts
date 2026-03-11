import type { Serialize } from 'nitropack/types'
import type { HistoryChat } from '#shared/types/history.d'
import * as schema from '~~/server/db/schema'

type FolderRow = Pick<
  typeof schema.folders.$inferSelect,
  'id'
  | 'name'
  | 'pinnedAt'
  | 'archivedAt'
  | 'activityAt'
  | 'createdAt'
>

export type Folder = Serialize<FolderRow>

export interface FoldersResponse {
  folders: Folder[]
  pinned: Folder[]
}

export interface FolderChatsResponse {
  folder: Folder
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
}
