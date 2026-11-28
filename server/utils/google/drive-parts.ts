import { extractLocalFileStorageKey } from '#shared/utils/files'
import {
  DRIVE_FILE_PART_TYPE,
  driveFilePartFromFile,
} from '#shared/utils/google-drive'
import type { DataDriveFilePart } from '#shared/utils/google-drive'
import { getOwnedFilesByStorageKeys } from '~~/server/utils/files/file-governance'

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
    userId: number
    parts: readonly TPart[]
  },
): Promise<TPart[]> {
  const withoutClientParts = input.parts.filter((part) => {
    return part.type !== DRIVE_FILE_PART_TYPE
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

  const ownedFiles = await getOwnedFilesByStorageKeys(
    input.userId,
    storageKeys,
  )
  const copies = new Map<string, DataDriveFilePart>()

  for (const [storageKey, file] of ownedFiles) {
    const reference = file.name && file.type
      ? driveFilePartFromFile({
        name: file.name,
        type: file.type,
        externalSource: file.externalSource,
        externalId: file.externalId,
      })
      : null

    if (reference) {
      copies.set(storageKey, reference)
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
