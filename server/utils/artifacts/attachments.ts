import type { RequestEvent } from 'nuxt/server'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  isDataArtifactAttachmentPart,
  toArtifactAttachmentPart,
} from '#shared/utils/artifacts'
import type { DataArtifactAttachmentPart } from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  FEATURE_UNAVAILABLE_WHY,
  requireFeature,
} from '~~/server/utils/features/guards'
import {
  ARTIFACT_ERROR_CODES,
  decodeArtifactId,
} from '~~/server/utils/artifacts/store'

type DbClient = ReturnType<typeof useDb>

export const ARTIFACT_ATTACHMENT_ERROR_CODE = 'artifact_attachment_unavailable'

function createAttachmentUnavailableError() {
  return createError({
    message: 'An attached artifact is no longer available',
    status: 400,
    code: ARTIFACT_ATTACHMENT_ERROR_CODE,
    why: 'The artifact was deleted or does not belong to your account',
    fix: 'Remove it from the message and send again',
  })
}

function createAttachmentTakenDownError() {
  return createError({
    message: 'An attached artifact is unavailable',
    status: 451,
    code: ARTIFACT_ERROR_CODES.takenDown,
    why: 'The artifact was disabled after a report',
    fix: 'Remove it from the message and send again',
  })
}

function isFeatureUnavailableError(exception: unknown): boolean {
  return (exception as { why?: string } | null)?.why
    === FEATURE_UNAVAILABLE_WHY
}

/**
 * Validates the artifacts a user message attaches and rewrites each
 * attachment part from the stored row, so a client can never persist a
 * forged title or kind. A message without attachments is returned as is and
 * costs nothing. Otherwise the caller needs the `artifacts` feature (404
 * `feature_unavailable` like every gated route, so a user without access
 * learns nothing), and every attached artifact must be the sender's own,
 * live and not taken down, at a version that exists. A missing or foreign
 * artifact is one and the same 400, so ids cannot be probed.
 *
 * `onUnavailable: 'drop'` is for a message that is already stored (a resend
 * or Regenerate): an attachment that no longer resolves, or all of them once
 * the sender lost access, is left out instead of failing the send.
 */
export async function resolveArtifactAttachmentParts<
  TPart extends { type: string },
>(input: {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  userId: number
  parts: readonly TPart[]
  logger: LoggerLike
  onUnavailable?: 'throw' | 'drop'
}): Promise<TPart[]> {
  const attachments = input.parts.filter(
    (part): part is TPart & DataArtifactAttachmentPart => {
      return isDataArtifactAttachmentPart(part)
    },
  )

  if (attachments.length === 0) {
    return [...input.parts]
  }

  const isDropping = input.onUnavailable === 'drop'

  try {
    await requireFeature(input.event, 'artifacts')
  } catch (exception) {
    if (!isDropping || !isFeatureUnavailableError(exception)) {
      throw exception
    }

    return input.parts.filter(part => !isDataArtifactAttachmentPart(part))
  }

  const internalIds = attachments
    .map(attachment => decodeArtifactId(attachment.data.artifactId))
    .filter((id): id is number => id !== null)
  const rows = internalIds.length === 0
    ? []
    : await input.db
      .select({
        id: schema.artifacts.id,
        kind: schema.artifacts.kind,
        title: schema.artifacts.title,
        currentVersion: schema.artifacts.currentVersion,
        takedownAt: schema.artifacts.takedownAt,
      })
      .from(schema.artifacts)
      .where(and(
        eq(schema.artifacts.userId, input.userId),
        inArray(schema.artifacts.id, internalIds),
      ))
  const rowsById = new Map(rows.map((row) => {
    return [row.id, row]
  }))
  const canonicalByPart = new Map<TPart, TPart | null>()

  for (const attachment of attachments) {
    const internalId = decodeArtifactId(attachment.data.artifactId)
    const row = internalId === null ? undefined : rowsById.get(internalId)

    if (
      !row
      || row.currentVersion < 1
      || attachment.data.version > row.currentVersion
    ) {
      if (isDropping) {
        canonicalByPart.set(attachment, null)

        continue
      }

      throw createAttachmentUnavailableError()
    }

    if (row.takedownAt) {
      if (isDropping) {
        canonicalByPart.set(attachment, null)

        continue
      }

      throw createAttachmentTakenDownError()
    }

    canonicalByPart.set(attachment, toArtifactAttachmentPart({
      artifactId: attachment.data.artifactId,
      version: attachment.data.version,
      kind: row.kind,
      title: row.title,
    }) as unknown as TPart)
  }

  input.logger.set({
    attributes: { artifacts: { attachedArtifacts: attachments.length } },
  })

  return input.parts.flatMap((part) => {
    if (!canonicalByPart.has(part)) {
      return [part]
    }

    const canonical = canonicalByPart.get(part)

    return canonical ? [canonical] : []
  })
}
