import { z } from 'zod'
import type { FeatureRole } from '#shared/utils/features/registry'
import { FEATURE_ROLES } from '#shared/utils/features/registry'

export const FEATURE_BASIS_POINTS_TOTAL = 10_000
export const FEATURE_GRANT_REASON_MAX_LENGTH = 200
export const FEATURE_GRANT_MAX_EXPIRY_DAYS = 365
export const ADMIN_USER_SEARCH_MIN_LENGTH = 3
export const ADMIN_USER_SEARCH_LIMIT = 20
export const ADMIN_PAGE_SIZE = 50

/**
 * Roles the admin UI and API may grant or revoke. Admin comes only from
 * `NUXT_ADMIN_EMAILS` in v1 (compliance pre-check C7).
 */
export const ASSIGNABLE_FEATURE_ROLES = ['tester'] as const

export type AssignableFeatureRole = typeof ASSIGNABLE_FEATURE_ROLES[number]

const basisPoints = z.number().int().min(0).max(FEATURE_BASIS_POINTS_TOTAL)

const featureRoleEnum = z.enum(
  FEATURE_ROLES as unknown as [FeatureRole, ...FeatureRole[]],
)

export const featureRulePatchSchema = z.object({
  enabled: z.boolean().optional(),
  rolloutBps: basisPoints.optional(),
  allowRoles: z
    .array(featureRoleEnum)
    .max(FEATURE_ROLES.length)
    .nullable()
    .optional(),
  variants: z
    .array(z.object({
      key: z.string().trim().min(1).max(64),
      weightBps: basisPoints,
    }))
    .max(20)
    .nullable()
    .optional(),
}).strict()

export type FeatureRulePatch = z.infer<typeof featureRulePatchSchema>

export const featureGrantInputSchema = z.object({
  userId: z.number().int().positive(),
  effect: z.enum(['allow', 'deny']),
  variant: z.string().trim().min(1).max(64).nullable().optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(FEATURE_GRANT_MAX_EXPIRY_DAYS)
    .nullable()
    .optional(),
  reason: z
    .string()
    .trim()
    .max(FEATURE_GRANT_REASON_MAX_LENGTH)
    .nullable()
    .optional(),
}).strict()

export type FeatureGrantInput = z.infer<typeof featureGrantInputSchema>

export const userRoleInputSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(ASSIGNABLE_FEATURE_ROLES),
}).strict()

export type UserRoleInput = z.infer<typeof userRoleInputSchema>
