import { and, gt, inArray, isNull, eq } from 'drizzle-orm'
import { isDataArtifactPart } from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  ARTIFACT_ID_CHUNK_SIZE,
  decodeArtifactId,
  encodeArtifactId,
} from '~~/server/utils/artifacts/store'
import type {
  ChatContextArtifact,
  ChatContextMessage,
  ChatContextVisibility,
} from '~~/server/utils/chats/context/sections'

type DbClient = ReturnType<typeof useDb>

type ReferencedVersions = Map<number, string>

/**
 * Every version of every artifact referenced by a `data-artifact` part, with
 * the title that part carries, keyed by public artifact id.
 */
export function collectArtifactReferences(
  messages: readonly ChatContextMessage[],
): Map<string, ReferencedVersions> {
  const references = new Map<string, ReferencedVersions>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isDataArtifactPart(part)) {
        continue
      }

      const versions = references.get(part.data.artifactId) ?? new Map()

      versions.set(part.data.version, part.data.title)
      references.set(part.data.artifactId, versions)
    }
  }

  return references
}

function pickLatestReferencedVersion(
  versions: ReferencedVersions,
  currentVersion: number,
): { version: number, title: string } | null {
  let latest: { version: number, title: string } | null = null

  for (const [version, title] of versions) {
    if (version < 1 || version > currentVersion) {
      continue
    }

    if (!latest || version > latest.version) {
      latest = { version, title }
    }
  }

  return latest
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = []
  const size = ARTIFACT_ID_CHUNK_SIZE

  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size))
  }

  return chunks
}

/**
 * Loads the artifacts a chat's `data-artifact` parts reference, keeping only
 * those owned by the chat owner that still exist and are not taken down.
 * `version` is the newest version the messages reference. Private
 * (owner) lists report the current title and `latestVersion` =
 * `currentVersion`; public (shared chat) lists use the title of the shared
 * part and `latestVersion` = `version`, so a shared chat never reveals a
 * newer version or a renamed title that was not shared.
 */
export async function loadChatContextArtifacts(input: {
  db: DbClient
  chatOwnerUserId: number
  messages: readonly ChatContextMessage[]
  visibility: ChatContextVisibility
}): Promise<Map<string, ChatContextArtifact>> {
  const references = collectArtifactReferences(input.messages)
  const internalIds = [...references.keys()]
    .map(decodeArtifactId)
    .filter((id): id is number => id !== null)
  const artifacts = new Map<string, ChatContextArtifact>()

  for (const ids of chunk(internalIds)) {
    const rows = await input.db
      .select({
        id: schema.artifacts.id,
        title: schema.artifacts.title,
        kind: schema.artifacts.kind,
        currentVersion: schema.artifacts.currentVersion,
      })
      .from(schema.artifacts)
      .where(and(
        inArray(schema.artifacts.id, ids),
        eq(schema.artifacts.userId, input.chatOwnerUserId),
        gt(schema.artifacts.currentVersion, 0),
        isNull(schema.artifacts.takedownAt),
      ))

    for (const row of rows) {
      const artifactId = encodeArtifactId(row.id)
      const versions = references.get(artifactId)
      const latest = versions
        ? pickLatestReferencedVersion(versions, row.currentVersion)
        : null

      if (!latest) {
        continue
      }

      const isPublic = input.visibility === 'public'

      artifacts.set(artifactId, {
        title: isPublic ? latest.title : row.title,
        kind: row.kind,
        version: latest.version,
        latestVersion: isPublic ? latest.version : row.currentVersion,
      })
    }
  }

  return artifacts
}
