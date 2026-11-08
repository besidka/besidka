import type {
  FeatureKey,
  FeatureKeyKind,
  FeatureOptIn,
  FeatureSpend,
  FeatureStage,
} from '#shared/utils/features/registry'

export interface ClientFeatureState {
  enabled: boolean
  active: boolean
  variant: string | null
}

export interface ClientFeaturesPayload {
  features: Partial<Record<FeatureKey, ClientFeatureState>>
  isAdmin: boolean
}

export interface LabsFeature {
  key: FeatureKey
  title: string
  description: string
  stage: FeatureStage
  spend: FeatureSpend
  optIn: FeatureOptIn
  requires: { keyKinds: FeatureKeyKind[] }
  parent: FeatureKey | null
  optedIn: boolean
  active: boolean
}

export interface LabsPayload {
  features: LabsFeature[]
  objectedToExperiments: boolean
}
