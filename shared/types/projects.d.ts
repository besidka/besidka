import type { Serialize } from 'nitropack/types'
import type { HistoryChat } from '#shared/types/history.d'
import * as schema from '~~/server/db/schema'

export type ProjectMemoryStatus = NonNullable<
  typeof schema.projects.$inferSelect['memoryStatus']
>

type ProjectRow = Pick<
  typeof schema.projects.$inferSelect,
  'id'
  | 'name'
  | 'instructions'
  | 'memory'
  | 'memoryStatus'
  | 'memoryUpdatedAt'
  | 'memoryDirtyAt'
  | 'memoryProvider'
  | 'memoryModel'
  | 'memoryError'
  | 'pinnedAt'
  | 'archivedAt'
  | 'activityAt'
  | 'createdAt'
>

export type Project = Serialize<ProjectRow>

export interface ProjectsResponse {
  projects: Project[]
  pinned: Project[]
  nextCursor: string | null
}

export interface ProjectChatsResponse {
  project: Project
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
}
