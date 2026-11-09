import {
  ARTIFACT_CREATED_VIA,
  ARTIFACT_KINDS,
  ARTIFACT_REPORT_DECISIONS,
  ARTIFACT_REPORT_PRIORITIES,
  ARTIFACT_REPORT_REASONS,
  ARTIFACT_REPORT_STATUSES,
  ARTIFACT_SHARE_CREATED_VIA,
  ARTIFACT_VERSION_CREATED_BY,
} from '#shared/utils/artifacts'
import {
  snakeCase, text, integer, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
  defaultSchemaTimestamps,
} from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const artifacts = snakeCase.table(
  'artifacts',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaTimestamps,
    userId: integer({ mode: 'number' }).notNull(),
    originChatId: publicId(),
    originMessageId: text(),
    kind: text({ enum: ARTIFACT_KINDS }).notNull(),
    title: text().notNull(),
    currentVersion: integer({ mode: 'number' }).notNull(),
    totalBytes: integer({ mode: 'number' }).notNull(),
    createdVia: text({ enum: ARTIFACT_CREATED_VIA }).notNull(),
    takedownAt: integer({ mode: 'timestamp' }),
    takedownReason: text(),
    legalHoldUntil: integer({ mode: 'timestamp' }),
  },
  table => [
    index('idx_artifacts_user_updated').on(table.userId, table.updatedAt),
    index('idx_artifacts_origin_chat').on(table.originChatId),
  ],
)

export const artifactVersions = snakeCase.table(
  'artifact_versions',
  {
    ...defaultSchemaIdOnly,
    artifactId: integer({ mode: 'number' }).notNull(),
    version: integer({ mode: 'number' }).notNull(),
    r2Key: text().notNull(),
    sha256: text().notNull(),
    sizeBytes: integer({ mode: 'number' }).notNull(),
    createdBy: text({ enum: ARTIFACT_VERSION_CREATED_BY }).notNull(),
    modelId: text(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_artifact_versions').on(table.artifactId, table.version),
  ],
)

export const artifactShares = snakeCase.table(
  'artifact_shares',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaTimestamps,
    artifactId: integer({ mode: 'number' }).notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    tokenHash: text().notNull(),
    tokenEncrypted: text().notNull(),
    createdVia: text({ enum: ARTIFACT_SHARE_CREATED_VIA }).notNull(),
    clientId: text(),
    pinnedVersion: integer({ mode: 'number' }),
    expiresAt: integer({ mode: 'timestamp' }),
    revokedAt: integer({ mode: 'timestamp' }),
    bridgeAllowed: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    storageAllowed: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    takedownAt: integer({ mode: 'timestamp' }),
    takedownReason: text(),
  },
  table => [
    uniqueIndex('uq_artifact_shares_token').on(table.tokenHash),
    index('idx_artifact_shares_artifact').on(table.artifactId),
    index('idx_artifact_shares_user').on(table.userId),
  ],
)

export const artifactStorage = snakeCase.table(
  'artifact_storage',
  {
    artifactId: integer({ mode: 'number' }).notNull(),
    viewerUserId: integer({ mode: 'number' }).notNull(),
    key: text().notNull(),
    value: text({ mode: 'json' }).$type<unknown>(),
    bytes: integer({ mode: 'number' }).notNull(),
    updatedAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  table => [
    primaryKey({
      columns: [table.artifactId, table.viewerUserId, table.key],
    }),
    index('idx_artifact_storage_viewer').on(table.viewerUserId),
  ],
)

export const artifactReports = snakeCase.table(
  'artifact_reports',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaCreatedAtOnly,
    shareId: integer({ mode: 'number' }),
    chatShareId: text(),
    artifactId: integer({ mode: 'number' }).notNull(),
    reporterUserId: integer({ mode: 'number' }),
    reporterEmail: text(),
    reporterName: text(),
    reason: text({ enum: ARTIFACT_REPORT_REASONS }).notNull(),
    details: text(),
    status: text({ enum: ARTIFACT_REPORT_STATUSES }).notNull(),
    priority: text({ enum: ARTIFACT_REPORT_PRIORITIES }),
    receiptSentAt: integer({ mode: 'timestamp' }),
    decision: text({ enum: ARTIFACT_REPORT_DECISIONS }),
    decidedAt: integer({ mode: 'timestamp' }),
    resolvedAt: integer({ mode: 'timestamp' }),
    decisionStatement: text(),
  },
  table => [
    index('idx_artifact_reports_status_created')
      .on(table.status, table.createdAt),
    index('idx_artifact_reports_artifact').on(table.artifactId),
  ],
)
