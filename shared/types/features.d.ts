import type { FeatureKey } from '#shared/utils/features/registry'

export interface ClientFeatureState {
  enabled: boolean
  active: boolean
  variant: string | null
}

export interface ClientFeaturesPayload {
  features: Partial<Record<FeatureKey, ClientFeatureState>>
  isAdmin: boolean
}
