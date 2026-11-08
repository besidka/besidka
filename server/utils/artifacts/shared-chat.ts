import type { RequestEvent } from 'nuxt/server'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import { ARTIFACT_DATA_PART_TYPE } from '#shared/utils/artifacts'
import { persistedMessageRoles } from '#shared/utils/chat-message-role'
import * as schema from '~~/server/db/schema'
import { decodeArtifactId } from '~~/server/utils/artifacts/store'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { requireGlobalFeature } from '~~/server/utils/features/global'

type DbClient = ReturnType<typeof useDb>

export interface SharedChatArtifact {
  shareId: string
  internalId: number
  chatOwnerUserId: number
}

export function createSharedArtifactNotFoundError() {
  return createError({
    message: 'Artifact not found',
    status: 404,
    why: 'This shared chat does not include this artifact',
  })
}

function referencedInChat(artifactId: string, version?: number) {
  const versionCondition = version === undefined
    ? sql``
    : sql`and json_extract(part.value, '$.data.version') = ${version}`

  return sql`exists (
    select 1 from ${schema.messages}, json_each(${schema.messages.parts}) as part
    where ${schema.messages.chatId} = ${schema.chats.id}
      and ${inArray(schema.messages.role, [...persistedMessageRoles])}
      and json_extract(part.value, '$.type') = ${ARTIFACT_DATA_PART_TYPE}
      and json_extract(part.value, '$.data.artifactId') = ${artifactId}
      ${versionCondition}
  )`
}

/**
 * One indexed query (`idx_messages_chat_id` plus the artifact primary key)
 * that answers whether a chat's persisted messages carry a `data-artifact`
 * part for this artifact (and version, when given) and whether that artifact
 * still exists and belongs to the chat's owner. Returns null otherwise, so a
 * branched chat that references another user's artifact exposes nothing.
 */
export async function findSharedChatArtifact(input: {
  db: DbClient
  chatId: typeof schema.chats.$inferSelect.id
  artifactId: string
  version?: number
}): Promise<{ internalId: number, chatOwnerUserId: number } | null> {
  const internalId = decodeArtifactId(input.artifactId)

  if (internalId === null) {
    return null
  }

  const [row] = await input.db
    .select({
      internalId: schema.artifacts.id,
      chatOwnerUserId: schema.chats.userId,
    })
    .from(schema.chats)
    .innerJoin(schema.artifacts, and(
      eq(schema.artifacts.id, internalId),
      eq(schema.artifacts.userId, schema.chats.userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .where(and(
      eq(schema.chats.id, input.chatId),
      referencedInChat(input.artifactId, input.version),
    ))
    .limit(1)

  return row ?? null
}

/**
 * Shared gate of the shared-chat artifact routes: the global `artifacts`
 * rule (kill switch, never the anonymous viewer's own flag), an active share
 * and membership of the artifact in that share's chat. Every failure is a
 * 404.
 */
export async function resolveSharedChatArtifact(input: {
  event: Pick<RequestEvent, 'context'>
  slug: string
  artifactId: string
  version?: number
}): Promise<SharedChatArtifact> {
  await requireGlobalFeature(input.event, 'artifacts')

  const share = await resolveActiveShareBySlug(input.slug, input.event)

  if (!share) {
    throw createSharedArtifactNotFoundError()
  }

  const artifact = await findSharedChatArtifact({
    db: useDb(),
    chatId: share.chatId,
    artifactId: input.artifactId,
    version: input.version,
  })

  if (!artifact) {
    throw createSharedArtifactNotFoundError()
  }

  return { shareId: share.id, ...artifact }
}
