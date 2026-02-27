export type ReasoningEnabledLevel = 'low' | 'medium' | 'high'

export type ReasoningLevel = 'off' | ReasoningEnabledLevel

export type ReasoningCapabilityMode = 'levels' | 'toggle'

export interface ReasoningLevelsCapability {
  mode: 'levels'
  levels: ReasoningEnabledLevel[]
}

export interface ReasoningToggleCapability {
  mode: 'toggle'
}

export type ReasoningCapability = ReasoningLevelsCapability
  | ReasoningToggleCapability
