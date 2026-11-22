import { and, eq, inArray } from 'drizzle-orm'
import { extractLocalFileStorageKey } from '#shared/utils/files'
import {
  driveFilePartFromFile,
  isDriveFilePart,
} from '#shared/utils/google-drive'
import type { DataDriveFilePart } from '#shared/utils/google-drive'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

const LOOKUP_CHUNK_SIZE = 90

function storageKeyOf(part: unknown): string | null {
  const record = part as { type?: unknown, url?: unknown } | null

  if (record?.type !== 'file' || typeof record.url !== 'string') {
    return null
  }

  return extractLocalFileStorageKey(record.url)
}

/**
 * Rebuilds the `data-drive-file` parts of a user message from the stored
 * rows. Whatever the client sent is dropped first, so a forged id, name or
 * link never reaches storage; then each `file` part whose row is the user's
 * own Google copy gets one canonical reference part right after it (Drive
 * file id, name, media type, and a link built on a fixed Drive host, no
 * content). A message without file parts costs no query. Because the part
 * comes from the row, a copy attached later from the library gets it too.
 */
export async function resolveDriveFileParts<TPart extends { type: string }>(
  input: {
    db: DbClient
    userId: number
    parts: readonly TPart[]
  },
): Promise<TPart[]> {
  const withoutClientParts = input.parts.filter((part) => {
    return !isDriveFilePart(part) && part.type !== 'data-drive-file'
  })
  const storageKeys = [...new Set(
    withoutClientParts.flatMap((part) => {
      const storageKey = storageKeyOf(part)

      return storageKey ? [storageKey] : []
    }),
  )]

  if (storageKeys.length === 0) {
    return withoutClientParts
  }

  const copies = new Map<string, DataDriveFilePart>()

  for (
    let start = 0;
    start < storageKeys.length;
    start += LOOKUP_CHUNK_SIZE
  ) {
    const rows = await input.db
      .select({
        storageKey: schema.files.storageKey,
        name: schema.files.name,
        type: schema.files.type,
        externalSource: schema.files.externalSource,
        externalId: schema.files.externalId,
      })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, input.userId),
        eq(schema.files.externalSource, 'google'),
        inArray(
          schema.files.storageKey,
          storageKeys.slice(start, start + LOOKUP_CHUNK_SIZE),
        ),
      ))

    for (const row of rows) {
      const part = driveFilePartFromFile(row)

      if (part) {
        copies.set(row.storageKey, part)
      }
    }
  }

  if (copies.size === 0) {
    return withoutClientParts
  }

  const seen = new Set<string>()

  return withoutClientParts.flatMap((part) => {
    const storageKey = storageKeyOf(part)
    const reference = storageKey ? copies.get(storageKey) : undefined

    if (!reference || seen.has(reference.data.driveFileId)) {
      return [part]
    }

    seen.add(reference.data.driveFileId)

    return [part, reference as unknown as TPart]
  })
}
