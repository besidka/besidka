import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  ADMIN_PAGE_SIZE,
  ADMIN_USER_SEARCH_LIMIT,
} from '#shared/utils/features/admin-schemas'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  getFeatureDefinition,
} from '#shared/utils/features/registry'
import * as schema from '~~/server/db/schema'
import {
  isEnvAdminEmail,
  isFeatureKillSwitched,
} from '~~/server/utils/features/evaluate'

type FeatureAdminReadDatabase = Pick<ReturnType<typeof useDb>, 'select'>

const MILLISECONDS_PER_SECOND = 1000

function toUnixSeconds(date: Date | null | undefined): number | null {
  return date ? Math.floor(date.getTime() / MILLISECONDS_PER_SECOND) : null
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => {
    return `\\${character}`
  })
}

function readAdminConfig(config: FeatureEvaluationConfig) {
  return {
    rolloutEnabled: config.featuresRolloutEnabled,
    hostMode: config.featuresHostMode,
  }
}

async function readRules(db: FeatureAdminReadDatabase) {
  const rows = await db
    .select({
      flag: schema.featureFlagRules.flag,
      enabled: schema.featureFlagRules.enabled,
      rolloutBps: schema.featureFlagRules.rolloutBps,
      allowRoles: schema.featureFlagRules.allowRoles,
      variants: schema.featureFlagRules.variants,
      updatedAt: schema.featureFlagRules.updatedAt,
    })
    .from(schema.featureFlagRules)

  return new Map(rows.map((row) => {
    return [row.flag, {
      enabled: row.enabled,
      rolloutBps: row.rolloutBps,
      allowRoles: row.allowRoles,
      variants: row.variants,
      updatedAt: toUnixSeconds(row.updatedAt),
    }]
  }))
}

async function readGrantCounts(
  db: FeatureAdminReadDatabase,
  flag?: string,
) {
  const rows = await db
    .select({
      flag: schema.featureGrants.flag,
      effect: schema.featureGrants.effect,
      total: count(),
    })
    .from(schema.featureGrants)
    .where(flag ? eq(schema.featureGrants.flag, flag) : undefined)
    .groupBy(schema.featureGrants.flag, schema.featureGrants.effect)
  const counts = new Map<string, { allow: number, deny: number }>()

  for (const row of rows) {
    const current = counts.get(row.flag) ?? { allow: 0, deny: 0 }

    current[row.effect] = row.total
    counts.set(row.flag, current)
  }

  return counts
}

function toFlagSummary(
  key: string,
  rules: Awaited<ReturnType<typeof readRules>>,
  counts: Awaited<ReturnType<typeof readGrantCounts>>,
  config: FeatureEvaluationConfig,
) {
  const definition = FEATURE_REGISTRY[key as keyof typeof FEATURE_REGISTRY]

  return {
    key: definition.key,
    title: definition.title,
    description: definition.description,
    stage: definition.stage,
    spend: definition.spend,
    optIn: definition.optIn,
    default: definition.default,
    allowRoles: definition.allowRoles,
    variants: definition.variants ?? [],
    parent: definition.parent ?? null,
    killSwitched: isFeatureKillSwitched(definition.key, config),
    rule: rules.get(definition.key) ?? null,
    grantCounts: counts.get(definition.key) ?? { allow: 0, deny: 0 },
  }
}

export async function listAdminFeatures(
  db: FeatureAdminReadDatabase,
  config: FeatureEvaluationConfig,
) {
  const rules = await readRules(db)
  const counts = await readGrantCounts(db)

  return {
    ...readAdminConfig(config),
    flags: FEATURE_KEYS.map((key) => {
      return toFlagSummary(key, rules, counts, config)
    }),
  }
}

export async function getAdminFeature(
  db: FeatureAdminReadDatabase,
  flag: string,
  config: FeatureEvaluationConfig,
) {
  if (!getFeatureDefinition(flag)) {
    return null
  }

  const rules = await readRules(db)
  const counts = await readGrantCounts(db, flag)

  return {
    ...readAdminConfig(config),
    flag: toFlagSummary(flag, rules, counts, config),
  }
}

export async function listAdminFeatureGrants(
  db: FeatureAdminReadDatabase,
  flag: string,
  offset: number,
) {
  const rows = await db
    .select({
      id: schema.featureGrants.id,
      userId: schema.featureGrants.userId,
      email: schema.users.email,
      name: schema.users.name,
      effect: schema.featureGrants.effect,
      variant: schema.featureGrants.variant,
      expiresAt: schema.featureGrants.expiresAt,
      reason: schema.featureGrants.reason,
      createdAt: schema.featureGrants.createdAt,
    })
    .from(schema.featureGrants)
    .leftJoin(schema.users, eq(schema.users.id, schema.featureGrants.userId))
    .where(eq(schema.featureGrants.flag, flag))
    .orderBy(desc(schema.featureGrants.id))
    .limit(ADMIN_PAGE_SIZE + 1)
    .offset(offset)

  return {
    grants: rows.slice(0, ADMIN_PAGE_SIZE).map((row) => {
      return {
        ...row,
        expiresAt: toUnixSeconds(row.expiresAt),
        createdAt: toUnixSeconds(row.createdAt),
      }
    }),
    nextOffset: rows.length > ADMIN_PAGE_SIZE ? offset + ADMIN_PAGE_SIZE : null,
  }
}

async function readRolesByUser(
  db: FeatureAdminReadDatabase,
  userIds: number[],
) {
  if (!userIds.length) {
    return new Map<number, { id: number, role: string }[]>()
  }

  const rows = await db
    .select({
      id: schema.userRoles.id,
      userId: schema.userRoles.userId,
      role: schema.userRoles.role,
    })
    .from(schema.userRoles)
    .where(inArray(schema.userRoles.userId, userIds))
  const roles = new Map<number, { id: number, role: string }[]>()

  for (const row of rows) {
    roles.set(row.userId, [
      ...roles.get(row.userId) ?? [],
      { id: row.id, role: row.role },
    ])
  }

  return roles
}

export async function searchAdminUsers(
  db: FeatureAdminReadDatabase,
  query: string,
  config: FeatureEvaluationConfig,
) {
  const pattern = escapeLikePattern(query.trim().toLowerCase())
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
    })
    .from(schema.users)
    .where(or(
      sql`lower(${schema.users.email}) like ${`${pattern}%`} escape '\\'`,
      sql`lower(${schema.users.name}) like ${`%${pattern}%`} escape '\\'`,
    ))
    .orderBy(schema.users.email)
    .limit(ADMIN_USER_SEARCH_LIMIT)
  const roles = await readRolesByUser(db, users.map((user) => {
    return user.id
  }))

  return users.map((user) => {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: roles.get(user.id) ?? [],
      isEnvAdmin: user.emailVerified === true
        && isEnvAdminEmail(user.email, config),
    }
  })
}

export async function listAdminUserRoles(
  db: FeatureAdminReadDatabase,
  config: FeatureEvaluationConfig,
) {
  const roleRows = await db
    .select({
      id: schema.userRoles.id,
      userId: schema.userRoles.userId,
      role: schema.userRoles.role,
      createdAt: schema.userRoles.createdAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.userRoles)
    .leftJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .orderBy(desc(schema.userRoles.id))
  const envAdminEmails = config.adminEmails
    .split(',')
    .map((email) => {
      return email.trim().toLowerCase()
    })
    .filter(Boolean)
  const envAdmins = envAdminEmails.length
    ? await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(
        inArray(sql`lower(${schema.users.email})`, envAdminEmails),
        eq(schema.users.emailVerified, true),
      ))
    : []

  return {
    roles: roleRows.map((row) => {
      return { ...row, createdAt: toUnixSeconds(row.createdAt) }
    }),
    envAdmins,
  }
}

export async function listAdminAuditLog(
  db: FeatureAdminReadDatabase,
  filters: { cursor?: number, flag?: string, targetUserId?: number },
) {
  const actor = alias(schema.users, 'actor')
  const target = alias(schema.users, 'target')
  const rows = await db
    .select({
      id: schema.featureAuditLog.id,
      action: schema.featureAuditLog.action,
      actorKind: schema.featureAuditLog.actorKind,
      actorUserId: schema.featureAuditLog.actorUserId,
      actorEmail: actor.email,
      flag: schema.featureAuditLog.flag,
      targetUserId: schema.featureAuditLog.targetUserId,
      targetEmail: target.email,
      before: schema.featureAuditLog.before,
      after: schema.featureAuditLog.after,
      createdAt: schema.featureAuditLog.createdAt,
    })
    .from(schema.featureAuditLog)
    .leftJoin(actor, eq(actor.id, schema.featureAuditLog.actorUserId))
    .leftJoin(target, eq(target.id, schema.featureAuditLog.targetUserId))
    .where(and(
      filters.cursor
        ? lt(schema.featureAuditLog.id, filters.cursor)
        : undefined,
      filters.flag ? eq(schema.featureAuditLog.flag, filters.flag) : undefined,
      filters.targetUserId
        ? eq(schema.featureAuditLog.targetUserId, filters.targetUserId)
        : undefined,
    ))
    .orderBy(desc(schema.featureAuditLog.id))
    .limit(ADMIN_PAGE_SIZE + 1)
  const entries = rows.slice(0, ADMIN_PAGE_SIZE)

  return {
    entries: entries.map((row) => {
      return { ...row, createdAt: toUnixSeconds(row.createdAt) }
    }),
    nextCursor: rows.length > ADMIN_PAGE_SIZE
      ? entries[entries.length - 1]?.id ?? null
      : null,
  }
}
