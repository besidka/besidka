import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import type { RenderAssetInput } from '~~/workers/doc-renderer/src/contract'

type DbClient = ReturnType<typeof useDb>

export const DOCUMENT_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg'] as const

export const DOCUMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const DOCUMENT_IMAGES_MAX_TOTAL_BYTES = 20 * 1024 * 1024

type DocumentImageMediaType = typeof DOCUMENT_IMAGE_MEDIA_TYPES[number]

const SAFE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export interface OwnedImageFile {
  id: string
  storageKey: string
  type: DocumentImageMediaType
  size: number
}

export interface ResolvedImageFiles {
  files: OwnedImageFile[]
  missingIds: string[]
}

export type LoadImageAssetsResult
  = | { ok: true, assets: RenderAssetInput[] }
    | { ok: false, code: 'asset_invalid' }

function isDocumentImageMediaType(
  value: string,
): value is DocumentImageMediaType {
  return (DOCUMENT_IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

function isDecodableFileId(fileId: string): boolean {
  if (!SAFE_FILE_ID_PATTERN.test(fileId)) {
    return false
  }

  try {
    const decoded = decodePublicId(fileId)

    return Number.isFinite(decoded) && decoded > 0
  } catch {
    return false
  }
}

/**
 * Looks up the image files a spec points at. Only files of `userId` with a
 * PNG or JPEG media type count; everything else, including a file of another
 * user, is reported as missing so the caller cannot tell the cases apart.
 */
export async function resolveOwnedImageFiles(
  db: DbClient,
  userId: number,
  fileIds: readonly string[],
): Promise<ResolvedImageFiles> {
  const uniqueIds = [...new Set(fileIds)]
  const decodableIds = uniqueIds.filter(isDecodableFileId)
  const files: OwnedImageFile[] = []

  if (decodableIds.length > 0) {
    const rows = await db.select({
      id: schema.files.id,
      storageKey: schema.files.storageKey,
      type: schema.files.type,
      size: schema.files.size,
    })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        inArray(schema.files.id, decodableIds),
      ))

    for (const row of rows) {
      if (isDocumentImageMediaType(row.type)) {
        files.push({
          id: row.id,
          storageKey: row.storageKey,
          type: row.type,
          size: row.size,
        })
      }
    }
  }

  const foundIds = new Set(files.map(file => file.id))

  return {
    files,
    missingIds: uniqueIds.filter(fileId => !foundIds.has(fileId)),
  }
}

/**
 * Reads the bytes of owned images for a server render, one R2 read after
 * another. Images over the per-image or total cap, and objects that no longer
 * exist, fail the whole load before any further read.
 */
export async function loadDocumentImageAssets(
  db: DbClient,
  userId: number,
  fileIds: readonly string[],
): Promise<LoadImageAssetsResult> {
  if (fileIds.length === 0) {
    return { ok: true, assets: [] }
  }

  const resolved = await resolveOwnedImageFiles(db, userId, fileIds)
  const totalBytes = resolved.files.reduce((sum, file) => sum + file.size, 0)
  const exceedsCaps = resolved.files.some((file) => {
    return file.size > DOCUMENT_IMAGE_MAX_BYTES
  }) || totalBytes > DOCUMENT_IMAGES_MAX_TOTAL_BYTES

  if (resolved.missingIds.length > 0 || exceedsCaps) {
    return { ok: false, code: 'asset_invalid' }
  }

  const storage = useFileStorage()
  const assets: RenderAssetInput[] = []

  for (const file of resolved.files) {
    const object = await storage.get(file.storageKey)

    if (!object) {
      return { ok: false, code: 'asset_invalid' }
    }

    assets.push({
      fileId: file.id,
      mediaType: file.type,
      bytes: new Uint8Array(await object.arrayBuffer()),
    })
  }

  return { ok: true, assets }
}
