import * as schema from '~~/server/db/schema'
import { EXTRACTION_NOW } from './memory-extraction-db'

type TestDb = ReturnType<typeof import('~~/server/utils/db').useDb>

export async function seedBackfillJob(
  db: TestDb,
  userId: number,
  values: Partial<typeof schema.memoryBackfillJobs.$inferInsert> = {},
) {
  const [job] = await db.insert(schema.memoryBackfillJobs).values({
    userId,
    status: 'running',
    totalChats: 0,
    processedChats: 0,
    createdEntries: 0,
    updatedEntries: 0,
    skippedChats: 0,
    failedChats: 0,
    consecutiveFailures: 0,
    inputTokens: 0,
    outputTokens: 0,
    chatAttempts: 0,
    dropped: {},
    modelSource: 'setting',
    modelProviderId: 'openai',
    modelGatewayId: null,
    modelId: 'gpt-test',
    estimate: null,
    createdBefore: EXTRACTION_NOW,
    ...values,
  }).returning()

  return job!
}
