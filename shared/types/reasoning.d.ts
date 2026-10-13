export type ReasoningEnabledLevel = 'low' | 'medium' | 'high'

export type ReasoningLevel = 'off' | ReasoningEnabledLevel

export type ReasoningCapabilityMode = 'levels' | 'toggle'

export interface ReasoningLevelsCapability {
  mode: 'levels'
  levels: ReasoningEnabledLevel[]
  /**
   * The provider cannot turn reasoning off for this model, so the menu
   * offers no `off` and an `off` request resolves to `defaultLevel`.
   */
  cannotDisable?: true
  defaultLevel?: ReasoningEnabledLevel
}

export interface ReasoningToggleCapability {
  mode: 'toggle'
}

export type ReasoningCapability = ReasoningLevelsCapability
  | ReasoningToggleCapability

export type ReasoningControlState = 'configurable' | 'always-on' | 'none'
