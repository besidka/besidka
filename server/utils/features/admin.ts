import type { KVNamespace } from '@cloudflare/workers-types'
import type { FeatureRole } from '#shared/utils/features/registry'
import type {
  FeatureGrantInput,
  FeatureRulePatch,
  UserRoleInput,
} from '#shared/utils/features/admin-schemas'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import {
  ASSIGNABLE_FEATURE_ROLES,
  FEATURE_BASIS_POINTS_TOTAL,
} from '#shared/utils/features/admin-schemas'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import * as schema from '~~/server/db/schema'
import { createFeatureFlagSalt } from '~~/server/db/schemas/features'
import { bustFeatureRulesCache } from '~~/server/utils/features/evaluate'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const SECONDS_PER_DAY = 24 * 60 * 60
const MILLISECONDS_PER_SECOND = 1000

type FeatureAdminDatabase = Pick<
  ReturnType<typeof useDb>,
  'batch' | 'select' | 'insert' | 'update' | 'delete'
>

export interface FeatureAdminActor {
  userId: number | null
  kind: 'ui' | 'mcp' | 'schedule'
  clientId?: string | null
  scheduleId?: number
}

export interface FeatureAdminContext {
  db: FeatureAdminDatabase
  kv: Pick<KVNamespace, 'get' | 'put' | 'delete'>
  actor: FeatureAdminActor
  rolloutEnabled: boolean
  logger: LoggerLike
  now?: Date
}

export type FeatureAdminAction
  = | 'rule.set'
    | 'grant.set'
    | 'grant.revoke'
    | 'role.set'
    | 'role.revoke'
    | 'schedule.create'
    | 'schedule.cancel'

interface FeatureRuleLedgerState {
  enabled: boolean
  rolloutBps: number
  allowRoles: string[] | null
  variants: FeatureRulePatch['variants'] | null
}

interface FeatureAccessLedgerEntry {
  action: FeatureAdminAction
  flag: string | null
  targetUserId: number | null
  effect: string | null
  expiresAt: string | null
  role?: FeatureRole
  clientId?: string
  scheduleId?: number
  scheduleRunAt?: string[]
  rule?: {
    before: FeatureRuleLedgerState | null
    after: FeatureRuleLedgerState
  }
}

type AuditSnapshot = Record<string, unknown> | null

export function throwAdminError(
  status: number,
  message: string,
  why: string,
  fix?: string,
): never {
  throw createError({ message, status, why, fix })
}

export function requireKnownFlag(flag: string) {
  const definition = getFeatureDefinition(flag)

  if (!definition) {
    throwAdminError(404, 'Feature not found', 'unknown_flag')
  }

  return definition
}

function toUnixSeconds(date: Date | null | undefined): number | null {
  return date ? Math.floor(date.getTime() / MILLISECONDS_PER_SECOND) : null
}

export function logFeatureAccess(
  context: FeatureAdminContext,
  entry: FeatureAccessLedgerEntry,
) {
  context.logger.set({
    attributes: {
      featureAccess: {
        ...entry,
        actorKind: context.actor.kind,
        ...(context.actor.clientId ? { clientId: context.actor.clientId } : {}),
        ...(context.actor.scheduleId
          ? { scheduleId: context.actor.scheduleId }
          : {}),
      },
    },
  })
}

export function buildAuditInsert(
  context: FeatureAdminContext,
  input: {
    action: FeatureAdminAction
    flag: string | null
    targetUserId: number | null
    before: AuditSnapshot
    after: AuditSnapshot
  },
) {
  return context.db.insert(schema.featureAuditLog).values({
    actorUserId: context.actor.userId,
    actorKind: context.actor.kind,
    clientId: context.actor.clientId ?? null,
    action: input.action,
    flag: input.flag,
    targetUserId: input.targetUserId,
    before: input.before,
    after: input.after,
    createdAt: context.now ?? new Date(),
  })
}

function validateVariants(
  flag: string,
  variants: FeatureRulePatch['variants'],
) {
  if (!variants?.length) {
    return
  }

  const definition = requireKnownFlag(flag)

  if (!definition.variants?.length || definition.spend !== 'none') {
    throwAdminError(
      400,
      'This feature has no variants',
      'variants_not_supported',
      'Only features without spend that define variants can be split',
    )
  }

  const keys = variants.map((variant) => {
    return variant.key
  })
  const knownKeys = new Set(definition.variants)
  const totalWeight = variants.reduce((total, variant) => {
    return total + variant.weightBps
  }, 0)

  if (new Set(keys).size !== keys.length) {
    throwAdminError(400, 'Variant keys repeat', 'variant_duplicate')
  }

  if (keys.some(key => !knownKeys.has(key))) {
    throwAdminError(400, 'Unknown variant', 'variant_unknown')
  }

  if (totalWeight !== FEATURE_BASIS_POINTS_TOTAL) {
    throwAdminError(
      400,
      'Variant weights must add up to 100%',
      'variant_weights_invalid',
      `Weights sum to ${totalWeight} of ${FEATURE_BASIS_POINTS_TOTAL} bps`,
    )
  }
}

function assertRolloutChangeAllowed(
  context: FeatureAdminContext,
  patch: FeatureRulePatch,
) {
  if (context.rolloutEnabled) {
    return
  }

  const raisesRollout = (patch.rolloutBps ?? 0) > 0
  const setsVariants = (patch.variants?.length ?? 0) > 0

  if (raisesRollout || setsVariants) {
    throwAdminError(
      409,
      'Gradual rollouts are switched off',
      'rollout_disabled',
      'They open when the Privacy notice 2026-11-experimental-features takes '
      + 'effect, or when NUXT_FEATURES_ROLLOUT_ENABLED forces them on',
    )
  }
}

/**
 * Creates or updates a flag's rule (a fresh salt on the first write), writes
 * the audit row in the same batch and busts the rules cache. Rollout and
 * variant changes are refused while the rollout gate is closed (the Privacy
 * notice is not yet in force, or `NUXT_FEATURES_ROLLOUT_ENABLED` forces it
 * off), except setting them back to zero (compliance pre-check C2). A failed
 * cache bust is logged, not thrown: the write is already committed and the
 * 300 s TTL bounds the stale window. The single write path for the admin
 * route and the schedule applier; the MCP tools never call it.
 */
export async function setFeatureRule(
  context: FeatureAdminContext,
  flag: string,
  patch: FeatureRulePatch,
) {
  requireKnownFlag(flag)

  if (!Object.values(patch).some(value => value !== undefined)) {
    throwAdminError(400, 'Nothing to change', 'empty_patch')
  }

  validateVariants(flag, patch.variants)
  assertRolloutChangeAllowed(context, patch)

  const [existing] = await context.db
    .select()
    .from(schema.featureFlagRules)
    .where(eq(schema.featureFlagRules.flag, flag))
    .limit(1)
  const now = context.now ?? new Date()
  const next = {
    enabled: patch.enabled ?? existing?.enabled ?? true,
    rolloutBps: patch.rolloutBps ?? existing?.rolloutBps ?? 0,
    allowRoles: patch.allowRoles === undefined
      ? existing?.allowRoles ?? null
      : patch.allowRoles,
    variants: patch.variants === undefined
      ? existing?.variants ?? null
      : patch.variants?.length ? patch.variants : null,
  }
  const write = existing
    ? context.db
      .update(schema.featureFlagRules)
      .set({ ...next, updatedBy: context.actor.userId, updatedAt: now })
      .where(eq(schema.featureFlagRules.flag, flag))
    : context.db.insert(schema.featureFlagRules).values({
      flag,
      ...next,
      salt: createFeatureFlagSalt(),
      updatedBy: context.actor.userId,
      createdAt: now,
      updatedAt: now,
    })
  const before = existing
    ? {
      enabled: existing.enabled,
      rolloutBps: existing.rolloutBps,
      allowRoles: existing.allowRoles,
      variants: existing.variants,
    }
    : null

  await context.db.batch([
    write,
    buildAuditInsert(context, {
      action: 'rule.set',
      flag,
      targetUserId: null,
      before,
      after: next,
    }),
  ])
  logFeatureAccess(context, {
    action: 'rule.set',
    flag,
    targetUserId: null,
    effect: next.enabled ? 'enabled' : 'disabled',
    expiresAt: null,
    rule: { before, after: next },
  })

  try {
    await bustFeatureRulesCache(context.kv)
  } catch (exception) {
    context.logger.set({
      attributes: {
        featureRulesCache: {
          operation: 'bust',
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return { flag, ...next }
}

async function requireExistingUser(
  db: FeatureAdminDatabase,
  userId: number,
) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)

  if (!user) {
    throwAdminError(404, 'User not found', 'user_not_found')
  }
}

function toGrantSnapshot(grant: {
  userId: number
  effect: string
  variant: string | null
  expiresAt: Date | null
  reason: string | null
}) {
  return {
    userId: grant.userId,
    effect: grant.effect,
    variant: grant.variant,
    expiresAt: toUnixSeconds(grant.expiresAt),
    reason: grant.reason,
  }
}

/**
 * Upserts one user's allow or deny grant for a flag (unique per user and
 * flag), with the audit row in the same batch. A grant's forced variant must
 * be one of the registry variants; a deny never carries one.
 */
export async function setFeatureGrant(
  context: FeatureAdminContext,
  flag: string,
  input: FeatureGrantInput,
) {
  const definition = requireKnownFlag(flag)
  const variant = input.effect === 'allow' ? input.variant ?? null : null

  if (variant && !definition.variants?.includes(variant)) {
    throwAdminError(400, 'Unknown variant', 'variant_unknown')
  }

  await requireExistingUser(context.db, input.userId)

  const now = context.now ?? new Date()
  const expiresAt = input.expiresInDays
    ? new Date(
      now.getTime()
      + input.expiresInDays * SECONDS_PER_DAY * MILLISECONDS_PER_SECOND,
    )
    : null
  const reason = input.reason?.trim() || null
  const [existing] = await context.db
    .select()
    .from(schema.featureGrants)
    .where(and(
      eq(schema.featureGrants.userId, input.userId),
      eq(schema.featureGrants.flag, flag),
    ))
    .limit(1)
  const next = {
    userId: input.userId,
    effect: input.effect,
    variant,
    expiresAt,
    reason,
  }

  await context.db.batch([
    context.db
      .insert(schema.featureGrants)
      .values({
        ...next,
        flag,
        grantedBy: context.actor.userId,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.featureGrants.userId, schema.featureGrants.flag],
        set: {
          effect: next.effect,
          variant: next.variant,
          expiresAt: next.expiresAt,
          reason: next.reason,
          grantedBy: context.actor.userId,
          createdAt: now,
        },
      }),
    buildAuditInsert(context, {
      action: 'grant.set',
      flag,
      targetUserId: input.userId,
      before: existing ? toGrantSnapshot(existing) : null,
      after: toGrantSnapshot(next),
    }),
  ])

  logFeatureAccess(context, {
    action: 'grant.set',
    flag,
    targetUserId: input.userId,
    effect: input.effect,
    expiresAt: expiresAt?.toISOString() ?? null,
  })

  return { flag, ...next }
}

export async function revokeFeatureGrant(
  context: FeatureAdminContext,
  grantId: number,
) {
  const [grant] = await context.db
    .select()
    .from(schema.featureGrants)
    .where(eq(schema.featureGrants.id, grantId))
    .limit(1)

  if (!grant) {
    throwAdminError(404, 'Grant not found', 'grant_not_found')
  }

  await context.db.batch([
    context.db
      .delete(schema.featureGrants)
      .where(eq(schema.featureGrants.id, grantId)),
    buildAuditInsert(context, {
      action: 'grant.revoke',
      flag: grant.flag,
      targetUserId: grant.userId,
      before: toGrantSnapshot(grant),
      after: null,
    }),
  ])

  logFeatureAccess(context, {
    action: 'grant.revoke',
    flag: grant.flag,
    targetUserId: grant.userId,
    effect: grant.effect,
    expiresAt: null,
  })

  return { id: grantId, flag: grant.flag, userId: grant.userId }
}

function isAssignableRole(role: string): boolean {
  return (ASSIGNABLE_FEATURE_ROLES as readonly string[]).includes(role)
}

function throwRoleNotAssignable(): never {
  throwAdminError(
    403,
    'This role cannot be changed here',
    'role_not_assignable',
    'Admins come only from NUXT_ADMIN_EMAILS',
  )
}

/**
 * Gives a user a role. Only `tester` is assignable in v1 (compliance
 * pre-check C7); granting a role the user already has writes nothing.
 */
export async function setUserRole(
  context: FeatureAdminContext,
  input: UserRoleInput,
) {
  if (!isAssignableRole(input.role)) {
    throwRoleNotAssignable()
  }

  await requireExistingUser(context.db, input.userId)

  const [existing] = await context.db
    .select({ id: schema.userRoles.id })
    .from(schema.userRoles)
    .where(and(
      eq(schema.userRoles.userId, input.userId),
      eq(schema.userRoles.role, input.role),
    ))
    .limit(1)

  if (existing) {
    return { id: existing.id, changed: false }
  }

  const [[inserted]] = await context.db.batch([
    context.db
      .insert(schema.userRoles)
      .values({
        userId: input.userId,
        role: input.role,
        grantedBy: context.actor.userId,
        createdAt: context.now ?? new Date(),
      })
      .returning({ id: schema.userRoles.id }),
    buildAuditInsert(context, {
      action: 'role.set',
      flag: null,
      targetUserId: input.userId,
      before: null,
      after: { userId: input.userId, role: input.role },
    }),
  ])

  logFeatureAccess(context, {
    action: 'role.set',
    flag: null,
    targetUserId: input.userId,
    effect: null,
    expiresAt: null,
    role: input.role,
  })

  return { id: inserted?.id ?? null, changed: true }
}

/**
 * Removes a role row. `admin` rows are never removed here (C7), which also
 * keeps the last admin from locking themselves out; the env admin stays the
 * escape hatch.
 */
export async function revokeUserRole(
  context: FeatureAdminContext,
  roleId: number,
) {
  const [role] = await context.db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.id, roleId))
    .limit(1)

  if (!role) {
    throwAdminError(404, 'Role not found', 'role_not_found')
  }

  if (!isAssignableRole(role.role)) {
    throwRoleNotAssignable()
  }

  await context.db.batch([
    context.db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.id, roleId)),
    buildAuditInsert(context, {
      action: 'role.revoke',
      flag: null,
      targetUserId: role.userId,
      before: { userId: role.userId, role: role.role },
      after: null,
    }),
  ])

  logFeatureAccess(context, {
    action: 'role.revoke',
    flag: null,
    targetUserId: role.userId,
    effect: null,
    expiresAt: null,
    role: role.role,
  })

  return { id: roleId, userId: role.userId, role: role.role }
}

export function logFeatureAdminRead(
  logger: LoggerLike,
  resource: string,
  resultCount: number,
) {
  logger.set({
    attributes: {
      featureAccess: {
        action: 'admin.read',
        resource,
        resultCount,
      },
    },
  })
}
