import type { KVNamespace } from '@cloudflare/workers-types'
import type {
  FeatureDefinition,
  FeatureRole,
} from '#shared/utils/features/registry'
import type {
  FeatureEvaluationConfig,
  FeatureEvaluationContext,
  FeatureHostMode,
  FeatureOptInState,
  FeatureProvider,
  FeatureResolution,
  FeatureRule,
  FeatureRules,
  FeatureUserState,
} from '~~/server/utils/features/provider'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import {
  EXPERIMENTS_OPT_IN_KEY,
  FEATURE_ROLES,
  getFeatureDefinition,
} from '#shared/utils/features/registry'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const FEATURE_RULES_CACHE_KEY = 'features:config:v1'
export const FEATURE_RULES_CACHE_TTL_SECONDS = 300
export const FEATURE_BUCKET_COUNT = 10_000

const featureHostModes: readonly FeatureHostMode[] = ['off', 'byok', 'hosted']

type FeatureDatabase = ReturnType<typeof useDb>

type FeatureKv = Pick<KVNamespace, 'get' | 'put' | 'delete'>

interface FeatureRuntimeConfig {
  adminEmails?: unknown
  featuresDisabled?: unknown
  featuresHostMode?: unknown
  featuresRolloutEnabled?: unknown
}

function isEnabledFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1'
}

export function isAdminTwoFactorRequired(): boolean {
  return !import.meta.dev && process.env.CI !== 'true'
}

export function getFeatureEvaluationConfig(
  runtimeConfig: FeatureRuntimeConfig = useRuntimeConfig(),
): FeatureEvaluationConfig {
  const hostMode = String(runtimeConfig.featuresHostMode || 'byok')
    .trim()
    .toLowerCase()

  return {
    adminEmails: String(runtimeConfig.adminEmails ?? ''),
    featuresDisabled: String(runtimeConfig.featuresDisabled ?? ''),
    featuresHostMode: featureHostModes.includes(hostMode as FeatureHostMode)
      ? hostMode as FeatureHostMode
      : 'off',
    featuresRolloutEnabled: isEnabledFlag(
      runtimeConfig.featuresRolloutEnabled,
    ),
    requireAdminTwoFactor: isAdminTwoFactorRequired(),
  }
}

function toCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => {
      return item.trim().toLowerCase()
    })
    .filter(Boolean)
}

export function isFeatureKillSwitched(
  flag: string,
  config: Pick<FeatureEvaluationConfig, 'featuresDisabled'>,
): boolean {
  const disabled = toCommaList(config.featuresDisabled)

  return disabled.includes('*') || disabled.includes(flag.toLowerCase())
}

type AdminCheckConfig = Pick<
  FeatureEvaluationConfig,
  'adminEmails' | 'requireAdminTwoFactor'
>

export function isAdminUser(
  userState: FeatureUserState | null,
  config: AdminCheckConfig,
): boolean {
  if (!userState || userState.emailVerified !== true) {
    return false
  }

  if (config.requireAdminTwoFactor && userState.twoFactorEnabled !== true) {
    return false
  }

  if (userState.roles.includes('admin')) {
    return true
  }

  return isEnvAdminEmail(userState.email, config)
}

export function isEnvAdminEmail(
  email: string | null | undefined,
  config: Pick<FeatureEvaluationConfig, 'adminEmails'>,
): boolean {
  if (!email) {
    return false
  }

  return toCommaList(config.adminEmails).includes(email.trim().toLowerCase())
}

export function isActiveOptIn(optIn: FeatureOptInState | undefined): boolean {
  if (!optIn?.optedInAt) {
    return false
  }

  if (!optIn.optedOutAt) {
    return true
  }

  return optIn.optedOutAt.getTime() < optIn.optedInAt.getTime()
}

export function hasObjectedToExperiments(
  userState: FeatureUserState | null,
): boolean {
  const objection = userState?.optIns[EXPERIMENTS_OPT_IN_KEY]

  if (!objection?.optedOutAt) {
    return false
  }

  if (!objection.optedInAt) {
    return true
  }

  return objection.optedOutAt.getTime() >= objection.optedInAt.getTime()
}

export async function computeFeatureBucket(input: string): Promise<number> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )

  return new DataView(digest).getUint32(0) % FEATURE_BUCKET_COUNT
}

function readEnvBinding(name: string): boolean {
  const bindings = env as unknown as Record<string, unknown> | undefined

  return Boolean(bindings?.[name])
}

function resolution(
  value: boolean,
  reason: FeatureResolution['reason'],
  extra: Partial<FeatureResolution> = {},
): FeatureResolution {
  return {
    value,
    variant: null,
    flagMetadata: {},
    ...extra,
    reason,
  }
}

function canRunExperiments(
  context: FeatureEvaluationContext,
): boolean {
  return context.config.featuresRolloutEnabled
    && !hasObjectedToExperiments(context.userState)
}

async function assignHashVariant(
  definition: FeatureDefinition,
  rule: FeatureRule | undefined,
  userId: number,
): Promise<string | null> {
  const allowedVariants = definition.variants ?? []
  const weights = (rule?.variants ?? []).filter((variant) => {
    return allowedVariants.includes(variant.key) && variant.weightBps > 0
  })

  if (!rule || weights.length === 0) {
    return null
  }

  const bucket = await computeFeatureBucket(
    `${definition.key}:${rule.salt}:variant:${userId}`,
  )

  let cumulativeWeight = 0

  for (const variant of weights) {
    cumulativeWeight += variant.weightBps

    if (bucket < cumulativeWeight) {
      return variant.key
    }
  }

  return null
}

async function withVariant(
  base: FeatureResolution,
  definition: FeatureDefinition,
  rule: FeatureRule | undefined,
  context: FeatureEvaluationContext,
): Promise<FeatureResolution> {
  if (!base.value || !context.userState || !canRunExperiments(context)) {
    return base
  }

  const variant = await assignHashVariant(
    definition,
    rule,
    context.userState.userId,
  )

  if (!variant) {
    return base
  }

  return {
    ...base,
    variant,
    flagMetadata: { ...base.flagMetadata, variantSource: 'hash' },
  }
}

function effectiveRoles(context: FeatureEvaluationContext): FeatureRole[] {
  const roles = new Set<FeatureRole>(
    (context.userState?.roles ?? []).filter((role) => {
      return role !== 'admin'
    }),
  )

  if (isAdminUser(context.userState, context.config)) {
    roles.add('admin')
  }

  return [...roles]
}

async function evaluateOwnSteps(
  definition: FeatureDefinition,
  context: FeatureEvaluationContext,
): Promise<FeatureResolution> {
  const { config, userState } = context
  const rule = context.rules[definition.key]
  const hasBinding = context.hasBinding ?? readEnvBinding

  if (isFeatureKillSwitched(definition.key, config)) {
    return resolution(false, 'KILL_SWITCH')
  }

  if (config.featuresHostMode === 'off') {
    return resolution(false, 'HOST_MODE')
  }

  const missingBinding = definition.requires.bindings.some((name) => {
    return !hasBinding(name)
  })

  if (missingBinding) {
    return resolution(false, 'HOST_MODE')
  }

  if (rule && !rule.enabled) {
    return resolution(false, 'DISABLED')
  }

  if (!userState) {
    return resolution(definition.default, 'ANONYMOUS')
  }

  const grant = userState.grants[definition.key]

  if (grant?.effect === 'deny') {
    return resolution(false, 'DENY_GRANT')
  }

  if (grant?.effect === 'allow') {
    const forcedVariant = grant.variant
      && definition.variants?.includes(grant.variant)
      ? grant.variant
      : null

    return resolution(true, 'ALLOW_GRANT', forcedVariant
      ? { variant: forcedVariant, flagMetadata: { variantSource: 'grant' } }
      : {})
  }

  const allowRoles = rule?.allowRoles ?? definition.allowRoles
  const roles = effectiveRoles(context)
  const hasAllowedRole = roles.some((role) => {
    return allowRoles.includes(role)
  })

  if (hasAllowedRole) {
    return resolution(true, 'ROLE')
  }

  const rolloutBps = canRunExperiments(context) ? rule?.rolloutBps ?? 0 : 0

  if (rule && rolloutBps > 0) {
    const bucket = await computeFeatureBucket(
      `${definition.key}:${rule.salt}:${userState.userId}`,
    )

    if (bucket < rolloutBps) {
      return withVariant(
        resolution(true, 'ROLLOUT', { bucket }),
        definition,
        rule,
        context,
      )
    }
  }

  return resolution(definition.default, 'DEFAULT')
}

/**
 * Decides whether the user in `context` has `flag`, without touching the
 * request: crons and background jobs pass their own rules and user state.
 * The first deciding step wins (docs/feature-flags.md, section 5). A child
 * flag is off whenever its parent is off; it then carries the parent's
 * reason and `flagMetadata.decidedBy`. Only the user id, roles, grants and
 * opt-ins are read, never other user attributes (pre-check C14).
 */
export async function evaluateFeature(
  flag: string,
  context: FeatureEvaluationContext,
): Promise<FeatureResolution> {
  const definition = getFeatureDefinition(flag)

  if (!definition) {
    return resolution(false, 'UNKNOWN')
  }

  const own = await evaluateOwnSteps(definition, context)

  if (!own.value || !definition.parent) {
    return own
  }

  const parent = await evaluateFeature(definition.parent, context)

  if (parent.value) {
    return own
  }

  return resolution(false, parent.reason, {
    flagMetadata: {
      decidedBy: parent.flagMetadata.decidedBy ?? definition.parent,
    },
  })
}

export function isFeatureActive(
  flag: string,
  featureResolution: Pick<FeatureResolution, 'value'>,
  userState: FeatureUserState | null,
): boolean {
  const definition = getFeatureDefinition(flag)

  if (!definition || !featureResolution.value) {
    return false
  }

  let current: FeatureDefinition | undefined = definition

  while (current) {
    if (
      current.optIn === 'required'
      && !isActiveOptIn(userState?.optIns[current.key])
    ) {
      return false
    }

    current = current.parent ? getFeatureDefinition(current.parent) : undefined
  }

  return true
}

export const localFeatureProvider: FeatureProvider = {
  resolveBoolean(flag, context) {
    return evaluateFeature(flag, context)
  },
  async resolveString(flag, context) {
    const result = await evaluateFeature(flag, context)

    return {
      ...result,
      value: result.value ? result.variant : null,
    }
  },
}

function clampBasisPoints(value: unknown): number {
  const basisPoints = Math.trunc(Number(value))

  if (!Number.isFinite(basisPoints)) {
    return 0
  }

  return Math.min(FEATURE_BUCKET_COUNT, Math.max(0, basisPoints))
}

function toVariantWeights(value: unknown): FeatureRule['variants'] {
  if (!Array.isArray(value)) {
    return null
  }

  return value
    .filter((variant) => {
      return variant !== null
        && typeof variant === 'object'
        && typeof variant.key === 'string'
    })
    .map((variant) => {
      return {
        key: variant.key as string,
        weightBps: clampBasisPoints(variant.weightBps),
      }
    })
}

function toFeatureRule(row: FeatureRule): FeatureRule {
  return {
    flag: String(row.flag),
    enabled: Boolean(row.enabled),
    rolloutBps: clampBasisPoints(row.rolloutBps),
    allowRoles: Array.isArray(row.allowRoles)
      ? row.allowRoles.filter((role) => {
        return typeof role === 'string' && isFeatureRole(role)
      })
      : null,
    variants: toVariantWeights(row.variants),
    salt: String(row.salt),
  }
}

function toRulesMap(rows: FeatureRule[]): FeatureRules {
  return Object.fromEntries(rows
    .filter((row) => {
      return row !== null && typeof row === 'object'
    })
    .map((row) => {
      const rule = toFeatureRule(row)

      return [rule.flag, rule]
    }))
}

function logRulesCacheError(
  operation: 'read' | 'write',
  exception: unknown,
  logger?: LoggerLike,
) {
  logger?.set({
    attributes: {
      featureRulesCache: {
        operation,
        error: exceptionMessage(exception),
      },
    },
  })
}

async function readCachedRules(
  kv: FeatureKv,
  logger?: LoggerLike,
): Promise<FeatureRules | null> {
  try {
    const cached = await kv.get(FEATURE_RULES_CACHE_KEY)

    if (!cached) {
      return null
    }

    const rows = JSON.parse(cached)

    return Array.isArray(rows) ? toRulesMap(rows) : null
  } catch (exception) {
    logRulesCacheError('read', exception, logger)

    return null
  }
}

/**
 * Reads every `feature_flag_rules` row through the KV cache
 * (`features:config:v1`, 300 s). A cache miss or a KV failure falls back to
 * one D1 query; the write-back is best effort.
 */
export async function loadFeatureRules(
  kv: FeatureKv,
  db: Pick<FeatureDatabase, 'select'>,
  logger?: LoggerLike,
): Promise<FeatureRules> {
  const cached = await readCachedRules(kv, logger)

  if (cached) {
    return cached
  }

  const rows = await db
    .select({
      flag: schema.featureFlagRules.flag,
      enabled: schema.featureFlagRules.enabled,
      rolloutBps: schema.featureFlagRules.rolloutBps,
      allowRoles: schema.featureFlagRules.allowRoles,
      variants: schema.featureFlagRules.variants,
      salt: schema.featureFlagRules.salt,
    })
    .from(schema.featureFlagRules)

  try {
    await kv.put(FEATURE_RULES_CACHE_KEY, JSON.stringify(rows), {
      expirationTtl: FEATURE_RULES_CACHE_TTL_SECONDS,
    })
  } catch (exception) {
    logRulesCacheError('write', exception, logger)
  }

  return toRulesMap(rows)
}

export async function bustFeatureRulesCache(kv: FeatureKv): Promise<void> {
  await kv.delete(FEATURE_RULES_CACHE_KEY)
}

function isFeatureRole(value: string): value is FeatureRole {
  return FEATURE_ROLES.includes(value as FeatureRole)
}

/**
 * Loads one user's roles, unexpired grants and opt-ins plus the identity
 * fields the admin check needs, in a single D1 batch. Nothing per user is
 * cached in KV, so a grant takes effect on the next request.
 */
export async function loadUserFeatureState(
  db: Pick<FeatureDatabase, 'batch' | 'select'>,
  userId: number,
  now: Date = new Date(),
): Promise<FeatureUserState | null> {
  const [users, roles, grants, optIns] = await db.batch([
    db
      .select({
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        twoFactorEnabled: schema.users.twoFactorEnabled,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId)),
    db
      .select({
        flag: schema.featureGrants.flag,
        effect: schema.featureGrants.effect,
        variant: schema.featureGrants.variant,
      })
      .from(schema.featureGrants)
      .where(and(
        eq(schema.featureGrants.userId, userId),
        or(
          isNull(schema.featureGrants.expiresAt),
          gt(schema.featureGrants.expiresAt, now),
        ),
      )),
    db
      .select({
        flag: schema.featureOptIns.flag,
        optedInAt: schema.featureOptIns.optedInAt,
        optedOutAt: schema.featureOptIns.optedOutAt,
      })
      .from(schema.featureOptIns)
      .where(eq(schema.featureOptIns.userId, userId)),
  ])
  const user = users[0]

  if (!user) {
    return null
  }

  return {
    userId,
    email: user.email,
    emailVerified: user.emailVerified === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
    roles: roles
      .map((row) => {
        return row.role
      })
      .filter(isFeatureRole),
    grants: Object.fromEntries(grants.map((grant) => {
      return [grant.flag, { effect: grant.effect, variant: grant.variant }]
    })),
    optIns: Object.fromEntries(optIns.map((optIn) => {
      return [optIn.flag, {
        optedInAt: optIn.optedInAt,
        optedOutAt: optIn.optedOutAt,
      }]
    })),
  }
}
