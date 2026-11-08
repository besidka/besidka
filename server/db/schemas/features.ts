import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchemaIdOnly,
  defaultSchemaCreatedAtOnly,
  defaultSchemaTimestamps,
} from '../../utils/schema'

export const FEATURE_ROLES = ['admin', 'tester'] as const
export const FEATURE_GRANT_EFFECTS = ['allow', 'deny'] as const
export const FEATURE_AUDIT_ACTOR_KINDS = ['ui', 'mcp', 'env'] as const

export interface FeatureFlagVariantWeight {
  key: string
  weightBps: number
}

const featureFlagSaltBytes = 16

export function createFeatureFlagSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(featureFlagSaltBytes))

  return Array.from(bytes, (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

export const userRoles = snakeCase.table(
  'user_roles',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    role: text({ enum: FEATURE_ROLES }).notNull(),
    grantedBy: integer({ mode: 'number' }),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_user_roles_user_role').on(table.userId, table.role),
  ],
)

export const featureFlagRules = snakeCase.table(
  'feature_flag_rules',
  {
    flag: text().primaryKey(),
    enabled: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => true),
    rolloutBps: integer({ mode: 'number' })
      .notNull()
      .$defaultFn(() => 0),
    allowRoles: text({ mode: 'json' }).$type<string[]>(),
    variants: text({ mode: 'json' }).$type<FeatureFlagVariantWeight[]>(),
    salt: text()
      .notNull()
      .$defaultFn(createFeatureFlagSalt),
    updatedBy: integer({ mode: 'number' }),
    ...defaultSchemaTimestamps,
  },
)

export const featureGrants = snakeCase.table(
  'feature_grants',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    flag: text().notNull(),
    effect: text({ enum: FEATURE_GRANT_EFFECTS }).notNull(),
    variant: text(),
    expiresAt: integer({ mode: 'timestamp' }),
    reason: text(),
    grantedBy: integer({ mode: 'number' }),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_feature_grants_user_flag').on(table.userId, table.flag),
    index('idx_feature_grants_flag').on(table.flag),
  ],
)

export const featureOptIns = snakeCase.table(
  'feature_opt_ins',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    flag: text().notNull(),
    optedInAt: integer({ mode: 'timestamp' }),
    optedOutAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_feature_opt_ins_user_flag').on(table.userId, table.flag),
  ],
)

export const featureAuditLog = snakeCase.table(
  'feature_audit_log',
  {
    ...defaultSchemaIdOnly,
    actorUserId: integer({ mode: 'number' }),
    actorKind: text({ enum: FEATURE_AUDIT_ACTOR_KINDS }).notNull(),
    clientId: text(),
    action: text().notNull(),
    flag: text(),
    targetUserId: integer({ mode: 'number' }),
    before: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    after: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    index('idx_feature_audit_created').on(table.createdAt),
    index('idx_feature_audit_flag').on(table.flag, table.createdAt),
    index('idx_feature_audit_target').on(table.targetUserId),
    index('idx_feature_audit_actor').on(table.actorUserId),
  ],
)
