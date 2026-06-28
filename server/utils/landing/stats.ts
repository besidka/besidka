import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export interface LandingStats {
  users: number
  chats: number
  messages: number
  files: number
  updatedAt: string
}

export async function readStatsFromDb(): Promise<LandingStats> {
  const db = useDb()

  const counts = await db.get<{
    users: number
    chats: number
    messages: number
    files: number
  }>(sql`
    SELECT
      (SELECT count(*) FROM ${schema.users}) AS users,
      (SELECT count(*) FROM ${schema.chats}) AS chats,
      (SELECT count(*) FROM ${schema.messages}) AS messages,
      (SELECT count(*) FROM ${schema.files}) AS files
  `)

  return {
    users: counts?.users ?? 0,
    chats: counts?.chats ?? 0,
    messages: counts?.messages ?? 0,
    files: counts?.files ?? 0,
    updatedAt: new Date().toISOString(),
  }
}

export const cachedStats = defineCachedFunction(
  async (_event: H3Event | undefined) => {
    return readStatsFromDb()
  },
  {
    name: 'landing-stats',
    maxAge: 24 * 60 * 60,
    swr: true,
    staleMaxAge: 24 * 60 * 60,
    getKey: (_event: H3Event | undefined) => 'global',
    group: 'landing',
  },
)
