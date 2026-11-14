import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type {
  SkillFileKind,
  SkillLicenseClass,
  SkillSourceKind,
  SkillVersionOrigin,
} from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>
type BatchStatements = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]

export interface SkillVersionRecord {
  skillId: string
  userId: number
  version: number
  origin: SkillVersionOrigin
  createdByClientId?: string | null
  sourceKind?: SkillSourceKind | null
  sourceUrl?: string | null
  sourceRef?: string | null
  sourcePath?: string | null
  sourceVersion?: string | null
  sha256: string
  filesCount: number
  bytes: number
  licenseClass: SkillLicenseClass
  licenseFileSha256: string | null
  findings: Record<string, number> | null
  note?: string | null
}

export interface SkillVersionFileRecord {
  path: string
  blobSha256: string
  bytes: number
  kind: SkillFileKind
}

const VERSION_INSERT_COLUMNS = Object.entries(
  getTableColumns(schema.skillVersions),
).filter(([key]) => {
  return key !== 'id'
})
const FILE_INSERT_COLUMNS = Object.entries(
  getTableColumns(schema.skillFiles),
).filter(([key]) => {
  return key !== 'id'
})

export function asBatch(statements: unknown[]): BatchStatements {
  return statements as unknown as BatchStatements
}

/**
 * Plain inserts of a version row and its file rows, for a skill nobody else
 * can reach yet (create) and for the import paths.
 */
export function buildVersionStatements(
  db: DbClient,
  record: SkillVersionRecord,
  files: SkillVersionFileRecord[],
) {
  return [
    db.insert(schema.skillVersions).values({
      skillId: record.skillId,
      userId: record.userId,
      version: record.version,
      origin: record.origin,
      createdByClientId: record.createdByClientId ?? null,
      sourceKind: record.sourceKind ?? null,
      sourceUrl: record.sourceUrl ?? null,
      sourceRef: record.sourceRef ?? null,
      sourcePath: record.sourcePath ?? null,
      sourceVersion: record.sourceVersion ?? null,
      sha256: record.sha256,
      filesCount: record.filesCount,
      bytes: record.bytes,
      licenseClass: record.licenseClass,
      licenseFileSha256: record.licenseFileSha256,
      findings: record.findings,
      note: record.note ?? null,
    }),
    ...files.map((file) => {
      return db.insert(schema.skillFiles).values({
        skillId: record.skillId,
        userId: record.userId,
        version: record.version,
        path: file.path,
        blobSha256: file.blobSha256,
        bytes: file.bytes,
        kind: file.kind,
      })
    }),
  ]
}

interface DriverColumn {
  name: string
  mapToDriverValue: (value: unknown) => unknown
}

type InsertColumn = [string, DriverColumn]

function toDriverValue(column: DriverColumn, value: unknown) {
  return value === null || value === undefined
    ? null
    : column.mapToDriverValue(value)
}

/**
 * `insert ... select <values> where <guard>`: the row is written only while
 * the guard holds at the moment the statement runs. Column names and value
 * encoding come from the Drizzle table, so the public-id and JSON columns
 * are encoded exactly as a builder insert would encode them.
 */
function guardedInsert(
  db: DbClient,
  table: typeof schema.skillVersions | typeof schema.skillFiles,
  columns: InsertColumn[],
  values: Record<string, unknown>,
  guard: SQL,
) {
  const columnList = sql.join(
    columns.map(([, column]) => {
      return sql.identifier(column.name)
    }),
    sql`, `,
  )
  const valueList = sql.join(
    columns.map(([key, column]) => {
      return sql`${toDriverValue(column, values[key])}`
    }),
    sql`, `,
  )

  return db.run(sql`
    insert into ${table} (${columnList})
    select ${valueList}
    where ${guard}
  `)
}

export function uniqueBlobBytesSql(userId: number): SQL {
  return sql`(
    select coalesce(sum(unique_blobs.bytes), 0) from (
      select distinct
        ${schema.skillFiles.skillId} as skill_id,
        ${schema.skillFiles.blobSha256} as blob_sha256,
        ${schema.skillFiles.bytes} as bytes
      from ${schema.skillFiles}
      where ${schema.skillFiles.userId} = ${userId}
    ) as unique_blobs
  )`
}

export interface GuardedVersionWrite {
  db: DbClient
  userId: number
  skillId: string
  baseVersion: number
  maxUserBytes: number
  incomingBytes: number
  record: SkillVersionRecord
  files: SkillVersionFileRecord[]
  skillSet: Partial<typeof schema.skills.$inferInsert>
}

/**
 * The guarded batch of a save, in the order that keeps every statement safe
 * on its own: (1) the version row, written only while the skill is still at
 * `baseVersion` and the user's unique blobs plus the new ones fit the cap (a
 * write that adds no new blob bytes always passes it);
 * (2) every file row, written only while that version row exists; (3) the
 * `skills` update, guarded the same way and returning its row, which is how
 * the caller learns the batch won. A stale save writes nothing, so it can
 * never leave a row on the number the winner uses. `pending_version` is not
 * touched.
 */
export function buildGuardedVersionStatements(input: GuardedVersionWrite) {
  const { db, userId, skillId, record } = input
  const skillAtBase = and(
    eq(schema.skills.id, skillId),
    eq(schema.skills.userId, userId),
    eq(schema.skills.currentVersion, input.baseVersion),
  )
  const versionExists = sql`exists (
    select 1 from ${schema.skillVersions}
    where ${and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
      eq(schema.skillVersions.version, record.version),
      eq(schema.skillVersions.sha256, record.sha256),
    )}
  )`
  const capGuard = input.incomingBytes > 0
    ? sql` and ${uniqueBlobBytesSql(userId)} + ${input.incomingBytes}
      <= ${input.maxUserBytes}`
    : sql``
  const versionGuard = sql`exists (
    select 1 from ${schema.skills} where ${skillAtBase}
  )${capGuard}`
  const now = new Date()
  const versionValues: Record<string, unknown> = {
    ...record,
    createdByClientId: record.createdByClientId ?? null,
    createdAt: now,
    note: record.note ?? null,
  }

  return [
    guardedInsert(
      db,
      schema.skillVersions,
      VERSION_INSERT_COLUMNS as never,
      versionValues,
      versionGuard,
    ),
    ...input.files.map((file) => {
      return guardedInsert(
        db,
        schema.skillFiles,
        FILE_INSERT_COLUMNS as never,
        {
          skillId,
          userId,
          version: record.version,
          path: file.path,
          blobSha256: file.blobSha256,
          bytes: file.bytes,
          kind: file.kind,
        },
        versionExists,
      )
    }),
    db.update(schema.skills)
      .set(input.skillSet)
      .where(and(skillAtBase, versionExists))
      .returning({ id: schema.skills.id }),
  ]
}
