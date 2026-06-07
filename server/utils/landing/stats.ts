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

  const [usersResult, chatsResult, messagesResult, filesResult]
    = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.users)
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.chats)
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.messages)
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.files)
        .get(),
    ])

  return {
    users: usersResult?.count ?? 0,
    chats: chatsResult?.count ?? 0,
    messages: messagesResult?.count ?? 0,
    files: filesResult?.count ?? 0,
    updatedAt: new Date().toISOString(),
  }
}

export const cachedStats = defineCachedFunction(
  async () => {
    return readStatsFromDb()
  },
  {
    name: 'landing-stats',
    maxAge: 24 * 60 * 60,
    swr: true,
    staleMaxAge: 24 * 60 * 60,
    getKey: () => 'global',
    group: 'landing',
  },
)
