import type { KVNamespace } from '@cloudflare/workers-types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import { createError } from 'evlog'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  FEATURE_GRANT_MAX_EXPIRY_DAYS,
  FEATURE_GRANT_REASON_MAX_LENGTH,
} from '#shared/utils/features/admin-schemas'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  isFeatureKey,
} from '#shared/utils/features/registry'
import * as schema from '~~/server/db/schema'
import {
  logFeatureAdminRead,
  revokeFeatureGrant,
  setFeatureGrant,
} from '~~/server/utils/features/admin'
import { listAdminFeatures } from '~~/server/utils/features/admin-queries'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isActiveOptIn,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { isFeatureAdminUserId } from '~~/server/utils/mcp/admin-scopes'

type DbClient = ReturnType<typeof useDb>

type FeatureKv = Pick<KVNamespace, 'get' | 'put' | 'delete'>

export const MCP_FEATURE_ACCESS_LIMIT = 100

const MILLISECONDS_PER_SECOND = 1000

const featureFlagSchema = z.string().trim().max(100).refine(isFeatureKey, {
  message: 'Unknown feature flag',
})

const userIdSchema = z.number().int().positive()

export const mcpListFeatureAccessShape = {
  flag: featureFlagSchema.optional().describe(
    'Only grants for this feature flag, for example "artifacts".',
  ),
  userId: userIdSchema.optional().describe(
    'Only this user\'s grants and roles, by numeric user id.',
  ),
  email: z.email().max(254).optional().describe(
    'Only this user\'s grants and roles, by exact account email. The '
    + 'result shows the user id, never the email.',
  ),
}

export const mcpSetFeatureAccessShape = {
  flag: featureFlagSchema.describe('The feature flag, for example "artifacts".'),
  access: z.enum(['allow', 'deny', 'clear']).describe(
    'allow gives the user the feature, deny keeps it off even for their '
    + 'role, clear removes the user\'s grant.',
  ),
  userId: userIdSchema.optional().describe(
    'The user, by numeric user id. Give userId or email.',
  ),
  email: z.email().max(254).optional().describe(
    'The user, by exact account email. Give userId or email.',
  ),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(FEATURE_GRANT_MAX_EXPIRY_DAYS)
    .optional()
    .describe('Days until an allow or deny grant expires.'),
  reason: z
    .string()
    .trim()
    .max(FEATURE_GRANT_REASON_MAX_LENGTH)
    .optional()
    .describe('Why, kept in the audit log. Do not include personal data.'),
}

const listFeatureAccessSchema = z.object(mcpListFeatureAccessShape).strict()

const setFeatureAccessSchema = z.object(mcpSetFeatureAccessShape).strict()

export type McpListFeatureAccessInput = z.infer<typeof listFeatureAccessSchema>

export type McpSetFeatureAccessInput = z.infer<typeof setFeatureAccessSchema>

export interface McpFeatureAdminContext {
  db: DbClient
  kv: FeatureKv
  userId: number
  clientId: string
  logger: LoggerLike
}

function toUnixSeconds(date: Date | null | undefined): number | null {
  return date ? Math.floor(date.getTime() / MILLISECONDS_PER_SECOND) : null
}

function throwNotFound(): never {
  throw createError({
    message: 'Not found',
    status: 404,
    why: 'unavailable',
  })
}

/**
 * The caller's own client-visible features: access, opt-in and variant. The
 * opt-in itself is never writable over MCP, because it authorises spending
 * the user's keys.
 */
export async function listMyFeatures(
  db: DbClient,
  kv: FeatureKv,
  userId: number,
  logger: LoggerLike,
) {
  const config = getFeatureEvaluationConfig()
  const [rules, userState] = await Promise.all([
    loadFeatureRules(kv, db, logger),
    loadUserFeatureState(db, userId),
  ])
  const context = { rules, userState, config }
  const features = []

  for (const key of FEATURE_KEYS) {
    const definition = FEATURE_REGISTRY[key]

    if (!definition.exposeToClient) {
      continue
    }

    const resolution = await evaluateFeature(key, context)

    features.push({
      key,
      title: definition.title,
      stage: definition.stage,
      enabled: resolution.value,
      active: isFeatureActive(key, resolution, userState),
      optedIn: isActiveOptIn(userState?.optIns[key]),
      variant: resolution.value ? resolution.variant : null,
    })
  }

  return { features }
}

/**
 * Answers a generic 404 unless the token's user is an admin right now, so a
 * token that kept `admin:features` after the role went away reveals nothing.
 */
export async function assertMcpFeatureAdmin(
  db: DbClient,
  userId: number,
): Promise<void> {
  if (!await isFeatureAdminUserId(db, userId)) {
    throwNotFound()
  }
}

/**
 * Every registry flag with its rule summary and grant counts. Read-only: no
 * MCP tool changes a rule, the rollout or the kill switch.
 */
export async function listMcpFeatureFlags(
  context: McpFeatureAdminContext,
) {
  await assertMcpFeatureAdmin(context.db, context.userId)

  const result = await listAdminFeatures(
    context.db,
    getFeatureEvaluationConfig(),
  )

  logFeatureAdminRead(context.logger, 'mcp.flags', result.flags.length)

  return result
}

async function findUserIdByEmail(
  db: DbClient,
  email: string,
): Promise<number | null> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1)

  return user?.id ?? null
}

async function resolveTargetUserId(
  db: DbClient,
  input: { userId?: number, email?: string },
): Promise<number | null> {
  if (input.userId !== undefined) {
    return input.userId
  }

  if (input.email !== undefined) {
    return await findUserIdByEmail(db, input.email)
  }

  return null
}

function assertSingleUserSelector(input: { userId?: number, email?: string }) {
  if (input.userId !== undefined && input.email !== undefined) {
    throw createError({
      message: 'Give userId or email, not both',
      status: 400,
      why: 'ambiguous_user',
    })
  }
}

/**
 * Grants for a flag or a user, at most 100 rows, newest first. Returns user
 * ids only, never an email, a name or the grant reason (pre-check C9): the
 * admin's AI client must not receive other users' personal data.
 */
export async function listMcpFeatureAccess(
  context: McpFeatureAdminContext,
  rawInput: McpListFeatureAccessInput,
) {
  await assertMcpFeatureAdmin(context.db, context.userId)

  const input = listFeatureAccessSchema.parse(rawInput)

  assertSingleUserSelector(input)

  const hasUserSelector = input.userId !== undefined
    || input.email !== undefined
  const targetUserId = await resolveTargetUserId(context.db, input)

  if (hasUserSelector && targetUserId === null) {
    throwNotFound()
  }

  const conditions = [
    input.flag ? eq(schema.featureGrants.flag, input.flag) : undefined,
    targetUserId === null
      ? undefined
      : eq(schema.featureGrants.userId, targetUserId),
  ]
  const grants = await context.db
    .select({
      id: schema.featureGrants.id,
      userId: schema.featureGrants.userId,
      flag: schema.featureGrants.flag,
      effect: schema.featureGrants.effect,
      variant: schema.featureGrants.variant,
      expiresAt: schema.featureGrants.expiresAt,
      createdAt: schema.featureGrants.createdAt,
    })
    .from(schema.featureGrants)
    .where(and(...conditions))
    .orderBy(desc(schema.featureGrants.id))
    .limit(MCP_FEATURE_ACCESS_LIMIT)
  const roles = targetUserId === null
    ? null
    : await context.db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, targetUserId))

  logFeatureAdminRead(context.logger, 'mcp.grants', grants.length)

  return {
    grants: grants.map((grant) => {
      return {
        ...grant,
        expiresAt: toUnixSeconds(grant.expiresAt),
        createdAt: toUnixSeconds(grant.createdAt),
      }
    }),
    ...(roles
      ? {
        userId: targetUserId,
        roles: roles.map((row) => {
          return row.role
        }),
      }
      : {}),
    limit: MCP_FEATURE_ACCESS_LIMIT,
  }
}

/**
 * Gives, denies or clears one user's access to one flag through the shared
 * admin writer, so the grant change, the audit row (`actor_kind 'mcp'` with
 * the client id) and the replay-ledger line match the admin UI. Echoes only
 * the user id. It never touches `feature_flag_rules`.
 */
export async function setMcpFeatureAccess(
  context: McpFeatureAdminContext,
  rawInput: McpSetFeatureAccessInput,
) {
  await assertMcpFeatureAdmin(context.db, context.userId)

  const input = setFeatureAccessSchema.parse(rawInput)

  assertSingleUserSelector(input)

  const targetUserId = await resolveTargetUserId(context.db, input)

  if (targetUserId === null) {
    if (input.userId === undefined && input.email === undefined) {
      throw createError({
        message: 'Give userId or email',
        status: 400,
        why: 'missing_user',
      })
    }

    throwNotFound()
  }

  const adminContext: FeatureAdminContext = {
    db: context.db,
    kv: context.kv,
    actor: {
      userId: context.userId,
      kind: 'mcp',
      clientId: context.clientId,
    },
    rolloutEnabled: getFeatureEvaluationConfig().featuresRolloutEnabled,
    logger: context.logger,
  }

  if (input.access === 'clear') {
    const [grant] = await context.db
      .select({ id: schema.featureGrants.id })
      .from(schema.featureGrants)
      .where(and(
        eq(schema.featureGrants.userId, targetUserId),
        eq(schema.featureGrants.flag, input.flag),
      ))
      .limit(1)

    if (!grant) {
      return {
        flag: input.flag,
        userId: targetUserId,
        access: 'clear',
        changed: false,
      }
    }

    await revokeFeatureGrant(adminContext, grant.id)

    return {
      flag: input.flag,
      userId: targetUserId,
      access: 'clear',
      changed: true,
    }
  }

  const grant = await setFeatureGrant(adminContext, input.flag, {
    userId: targetUserId,
    effect: input.access,
    expiresInDays: input.expiresInDays ?? null,
    reason: input.reason ?? null,
  })

  return {
    flag: grant.flag,
    userId: grant.userId,
    access: grant.effect,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    changed: true,
  }
}
