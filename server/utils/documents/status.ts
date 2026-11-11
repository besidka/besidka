import { and, eq } from 'drizzle-orm'
import { DOCUMENT_ERROR_CODES } from '#shared/utils/documents'
import type {
  DocumentFileRef,
  DocumentStatusResponse,
} from '#shared/utils/documents'
import * as schema from '~~/server/db/schema'
import { toDocumentStatusResponse } from '~~/server/utils/documents/store'
import type { DocumentRow } from '~~/server/utils/documents/store'

type DbClient = ReturnType<typeof useDb>

async function findOwnedFile(
  db: DbClient,
  userId: number,
  fileId: string,
): Promise<DocumentFileRef | null> {
  const [file] = await db.select({
    id: schema.files.id,
    storageKey: schema.files.storageKey,
    name: schema.files.name,
    size: schema.files.size,
    type: schema.files.type,
  })
    .from(schema.files)
    .where(and(
      eq(schema.files.id, fileId),
      eq(schema.files.userId, userId),
    ))
    .limit(1)

  return file ?? null
}

function isLeaseExpired(row: DocumentRow, now: Date): boolean {
  return row.status === 'rendering'
    && (row.renderLeaseUntil === null || row.renderLeaseUntil < now)
}

/**
 * The status a client should see. It never writes: a `rendering` row whose
 * lease expired is reported as `spec_ready` so the client can claim it again,
 * and a row whose file was deleted is reported as `failed` with
 * `file_deleted` unless it already failed.
 */
export async function resolveDocumentStatus(
  db: DbClient,
  userId: number,
  row: DocumentRow,
  now: Date = new Date(),
): Promise<DocumentStatusResponse> {
  const file = row.fileId ? await findOwnedFile(db, userId, row.fileId) : null

  if (row.fileId && !file && row.status !== 'failed') {
    return toDocumentStatusResponse({
      ...row,
      status: 'failed',
      errorCode: DOCUMENT_ERROR_CODES.fileDeleted,
    }, null)
  }

  if (isLeaseExpired(row, now)) {
    return toDocumentStatusResponse({ ...row, status: 'spec_ready' }, file)
  }

  return toDocumentStatusResponse(row, file)
}
