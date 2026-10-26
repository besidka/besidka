import type {
  ReasoningCapability,
  ReasoningEnabledLevel,
  ReasoningLevel,
} from '#shared/types/reasoning.d'
import type { ModelResearchConfig } from '#shared/types/research.d'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '~/types/web-search'

export type ToolsSection
  = | 'add'
    | 'search'
    | 'reasoning'
    | 'image'
    | 'project'
    | 'memory'

export type ChatInputTileId
  = | 'project'
    | 'memory'
    | 'deep-research'
    | 'image'
    | 'search'
    | 'reasoning'

export type ChatInputTileIcon
  = | { kind: 'icon', name: string }
    | { kind: 'provider', providerId: string }
    | { kind: 'reasoning', level: ReasoningLevel }

export interface ChatInputTile {
  id: ChatInputTileId
  section: ToolsSection | null
  icon: ChatInputTileIcon
  caption: string
  value: string
  chipLabel: string
  ariaLabel: string
  removeLabel: string | null
  isNeutral: boolean
  isAuto: boolean
  isDisabled: boolean
}

export interface SegmentedOption<Value extends string = string> {
  value: Value
  label: string
  title?: string
  sub?: string
  disabled?: boolean
  testId?: string
}

export type ReasoningMode = 'configurable' | 'always-on' | 'none'

export interface ChatInputToolsState {
  isNewChat: boolean
  webSearch: {
    visible: boolean
    selected: WebSearchSelection
    options: WebSearchOption[]
    isToolCallingSupported: boolean
    exaSearchLevel: ExaSearchLevel
    isAutoAvailable: boolean
    isAutoPreferred: boolean
  }
  reasoning: {
    visible: boolean
    mode: ReasoningMode
    level: ReasoningLevel
    levels: ReasoningEnabledLevel[]
    canDisable: boolean
    capability: ReasoningCapability | null
    defaultLevel: ReasoningLevel
  }
  image: {
    supported: boolean
    enabled: boolean
    required: boolean
  }
  files: {
    visible: boolean
    count: number
    isImageInputSupported: boolean
  }
  project: {
    visible: boolean
    context: { id: string, name: string } | null
  }
  memory: {
    excluded: boolean | null
  }
  research: ModelResearchConfig | null
  isDeepResearchModel: boolean
  isResearchJobActive: boolean
  isCapabilityResolved: boolean
}
