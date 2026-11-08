import type { FeatureRole } from '#shared/utils/features/registry'

export type FeatureResolutionReason
  = | 'UNKNOWN'
    | 'KILL_SWITCH'
    | 'HOST_MODE'
    | 'DISABLED'
    | 'ANONYMOUS'
    | 'DENY_GRANT'
    | 'ALLOW_GRANT'
    | 'ROLE'
    | 'ROLLOUT'
    | 'DEFAULT'

export type FeatureVariantSource = 'grant' | 'hash'

export type FeatureHostMode = 'off' | 'byok' | 'hosted'

export interface FeatureFlagMetadata {
  decidedBy?: string
  variantSource?: FeatureVariantSource
}

export interface FeatureResolution<Value = boolean> {
  value: Value
  variant: string | null
  reason: FeatureResolutionReason
  bucket?: number
  flagMetadata: FeatureFlagMetadata
}

export interface FeatureRule {
  flag: string
  enabled: boolean
  rolloutBps: number
  allowRoles: string[] | null
  variants: { key: string, weightBps: number }[] | null
  salt: string
}

export type FeatureRules = Readonly<Record<string, FeatureRule>>

export interface FeatureGrantState {
  effect: 'allow' | 'deny'
  variant: string | null
}

export interface FeatureOptInState {
  optedInAt: Date | null
  optedOutAt: Date | null
}

export interface FeatureUserState {
  userId: number
  email: string | null
  emailVerified: boolean
  twoFactorEnabled: boolean
  roles: FeatureRole[]
  grants: Readonly<Record<string, FeatureGrantState>>
  optIns: Readonly<Record<string, FeatureOptInState>>
}

export interface FeatureEvaluationConfig {
  featuresDisabled: string
  featuresHostMode: FeatureHostMode
  featuresRolloutEnabled: boolean
  adminEmails: string
  requireAdminTwoFactor: boolean
}

export interface FeatureEvaluationContext {
  userState: FeatureUserState | null
  rules: FeatureRules
  config: FeatureEvaluationConfig
  hasBinding?: (name: string) => boolean
}

/**
 * OpenFeature-shaped provider seam. The local provider evaluates every step
 * in-house; a later Flagship provider (P0-10) replaces only the rollout and
 * variant steps behind the same interface.
 */
export interface FeatureProvider {
  resolveBoolean(
    flag: string,
    context: FeatureEvaluationContext,
  ): Promise<FeatureResolution<boolean>>
  resolveString(
    flag: string,
    context: FeatureEvaluationContext,
  ): Promise<FeatureResolution<string | null>>
}
