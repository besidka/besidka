import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export interface LandingStats {
  users: number
  chats: number
  messages: number
  files: number
  uploadedFiles: number
  generatedImages: number
  sharedChats: number
  researches: number
  updatedAt: string
}

export const LANDING_STATS_CACHE_NAME = 'landing-stats-v4'

export async function readStatsFromDb(): Promise<LandingStats> {
  const db = useDb()

  const counts = await db.get<{
    users: number
    chats: number
    messages: number
    files: number
    uploadedFiles: number
    generatedImages: number
    sharedChats: number
    researches: number
  }>(sql`
    SELECT
      (SELECT count(*) FROM ${schema.users}) AS users,
      (SELECT count(*) FROM ${schema.chats}) AS chats,
      (SELECT count(*) FROM ${schema.messages}) AS messages,
      (SELECT count(*) FROM ${schema.files}) AS files,
      (
        SELECT count(*) FROM ${schema.files}
        WHERE ${schema.files.source} = 'upload'
      ) AS uploadedFiles,
      (
        SELECT count(*) FROM ${schema.files}
        WHERE ${schema.files.source} = 'assistant'
          AND ${schema.files.type} LIKE 'image/%'
      ) AS generatedImages,
      (SELECT count(*) FROM ${schema.chatShares}) AS sharedChats,
      (
        SELECT count(*) FROM ${schema.researchJobs}
        WHERE ${schema.researchJobs.status} = 'completed'
      ) AS researches
  `)

  return {
    users: counts?.users ?? 0,
    chats: counts?.chats ?? 0,
    messages: counts?.messages ?? 0,
    files: counts?.files ?? 0,
    uploadedFiles: counts?.uploadedFiles ?? 0,
    generatedImages: counts?.generatedImages ?? 0,
    sharedChats: counts?.sharedChats ?? 0,
    researches: counts?.researches ?? 0,
    updatedAt: new Date().toISOString(),
  }
}

export const cachedStats = defineCachedFunction(
  async (_event: H3Event | undefined) => {
    return readStatsFromDb()
  },
  {
    name: LANDING_STATS_CACHE_NAME,
    maxAge: 24 * 60 * 60,
    swr: true,
    staleMaxAge: 24 * 60 * 60,
    getKey: (_event: H3Event | undefined) => 'global',
    group: 'landing',
  },
)
