import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactKindCounts,
  ArtifactSummary,
} from '#shared/utils/artifacts'
import {
  createEmptyArtifactKindCounts,
  isArtifactKind,
} from '#shared/utils/artifacts'
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import {
  createArtifactNotFoundError,
  decodeArtifactId,
  encodeArtifactId,
} from '~~/server/utils/artifacts/store'

type DbClient = ReturnType<typeof useDb>

export interface ListArtifactsInput {
  db: DbClient
  userId: number
  offset: number
  limit: number
  query?: string
  kind?: ArtifactKind
  now?: Date
}

function versionCountSql() {
  return sql<number>`(
    select count(*) from ${schema.artifactVersions}
    where ${schema.artifactVersions.artifactId} = ${schema.artifacts.id}
  )`
}

function activeShareCountSql(now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000)

  return sql<number>`(
    select count(*) from ${schema.artifactShares}
    where ${schema.artifactShares.artifactId} = ${schema.artifacts.id}
      and ${schema.artifactShares.revokedAt} is null
      and ${schema.artifactShares.takedownAt} is null
      and (
        ${schema.artifactShares.expiresAt} is null
        or ${schema.artifactShares.expiresAt} > ${nowSeconds}
      )
  )`
}

export function summarySelection(now: Date) {
  return {
    id: schema.artifacts.id,
    title: schema.artifacts.title,
    kind: schema.artifacts.kind,
    currentVersion: schema.artifacts.currentVersion,
    totalBytes: schema.artifacts.totalBytes,
    createdVia: schema.artifacts.createdVia,
    createdAt: schema.artifacts.createdAt,
    updatedAt: schema.artifacts.updatedAt,
    takedownAt: schema.artifacts.takedownAt,
    originChatSlug: schema.chats.slug,
    originChatTitle: sql<string | null>`${schema.chats.title}`
      .as('origin_chat_title'),
    versionCount: versionCountSql(),
    activeShareCount: activeShareCountSql(now),
  }
}

type SummaryRow = {
  id: number
  title: string
  kind: ArtifactKind
  currentVersion: number
  createdVia: ArtifactSummary['createdVia']
  updatedAt: Date
  takedownAt: Date | null
  originChatSlug: string | null
  originChatTitle: string | null
  versionCount: number
  activeShareCount: number
}

function toArtifactSummary(row: SummaryRow): ArtifactSummary {
  return {
    id: encodeArtifactId(row.id),
    title: row.title,
    kind: row.kind,
    currentVersion: row.currentVersion,
    versionCount: Number(row.versionCount),
    updatedAt: row.updatedAt.toISOString(),
    originChatSlug: row.originChatSlug ?? null,
    originChatTitle: row.originChatTitle ?? null,
    createdVia: row.createdVia,
    activeShareCount: Number(row.activeShareCount),
    takenDown: row.takedownAt !== null,
  }
}

function originChatJoin() {
  return and(
    eq(schema.chats.id, schema.artifacts.originChatId),
    eq(schema.chats.userId, schema.artifacts.userId),
  )
}

export async function listArtifacts(
  input: ListArtifactsInput,
): Promise<{ items: ArtifactSummary[], total: number }> {
  const now = input.now ?? new Date()
  const search = input.query?.trim() ?? ''
  const filter = and(
    eq(schema.artifacts.userId, input.userId),
    gt(schema.artifacts.currentVersion, 0),
    input.kind ? eq(schema.artifacts.kind, input.kind) : undefined,
    search ? containsLikeEscaped(schema.artifacts.title, search) : undefined,
  )
  const itemsQuery = input.db
    .select(summarySelection(now))
    .from(schema.artifacts)
    .leftJoin(schema.chats, originChatJoin())
    .where(filter)
    .orderBy(desc(schema.artifacts.updatedAt), desc(schema.artifacts.id))
    .limit(input.limit)
    .offset(input.offset)
  const totalQuery = input.db
    .select({ total: count() })
    .from(schema.artifacts)
    .where(filter)
  const [rows, totalRows] = await input.db.batch([itemsQuery, totalQuery])

  return {
    items: rows.map(toArtifactSummary),
    total: Number(totalRows[0]?.total ?? 0),
  }
}

export async function countArtifactsByKind(input: {
  db: DbClient
  userId: number
}): Promise<ArtifactKindCounts> {
  const rows = await input.db
    .select({ kind: schema.artifacts.kind, total: count() })
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.userId, input.userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .groupBy(schema.artifacts.kind)
  const counts = createEmptyArtifactKindCounts()

  for (const row of rows) {
    if (isArtifactKind(row.kind)) {
      counts[row.kind] = Number(row.total)
    }
  }

  return counts
}

export async function getArtifactDetail(input: {
  db: DbClient
  userId: number
  artifactId: string
  now?: Date
}): Promise<ArtifactDetail> {
  const internalId = decodeArtifactId(input.artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const now = input.now ?? new Date()
  const [row] = await input.db
    .select(summarySelection(now))
    .from(schema.artifacts)
    .leftJoin(schema.chats, originChatJoin())
    .where(and(
      eq(schema.artifacts.id, internalId),
      eq(schema.artifacts.userId, input.userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .limit(1)

  if (!row) {
    throw createArtifactNotFoundError()
  }

  const versions = await input.db
    .select({
      version: schema.artifactVersions.version,
      sizeBytes: schema.artifactVersions.sizeBytes,
      createdBy: schema.artifactVersions.createdBy,
      createdAt: schema.artifactVersions.createdAt,
    })
    .from(schema.artifactVersions)
    .where(eq(schema.artifactVersions.artifactId, internalId))
    .orderBy(asc(schema.artifactVersions.version))

  return {
    ...toArtifactSummary(row),
    totalBytes: row.totalBytes,
    createdAt: row.createdAt.toISOString(),
    versions: versions.map((version) => {
      return {
        version: version.version,
        sizeBytes: version.sizeBytes,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
      }
    }),
  }
}
