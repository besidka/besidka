import type { ReasoningLevel } from '#shared/types/reasoning.d'
import {
  EXA_SEARCH_LEVEL_LABELS,
  type ExaSearchLevel,
} from '#shared/utils/exa-search-level'
import { resolveSupportedReasoningLevel } from '#shared/utils/reasoning'
import type {
  ChatInputTile,
  ChatInputToolsState,
} from '~/types/chat-input-tools'
import type { WebSearchSelection } from '~/types/web-search'
import {
  CHAT_MEMORY_EXCLUSION_HELPER,
  CHAT_MEMORY_EXCLUSION_ICON,
  CHAT_MEMORY_OFF_LABEL,
} from '~/utils/chat-memory-exclusion'

export const WEB_SEARCH_SHORT_LABELS: Record<
  Exclude<WebSearchSelection, 'off'>,
  string
> = {
  web_search: 'Built-in',
  web_search_brave: 'Brave',
  web_search_exa: 'Exa',
}

export const WEB_SEARCH_FULL_LABELS: Record<WebSearchSelection, string> = {
  off: 'Off',
  web_search: 'Model\'s built-in search',
  web_search_brave: 'Brave Search',
  web_search_exa: 'Exa',
}

const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const WEB_SEARCH_PROVIDER_IDS: Partial<Record<WebSearchSelection, string>> = {
  web_search_brave: 'brave',
  web_search_exa: 'exa',
}

const NEUTRAL_TILE_TONE = 'bg-base-content/7 dark:bg-base-300/40 '
  + 'border-base-content/15 text-base-content/75'

const ACCENT_TILE_TONE
  = 'bg-accent/10 dark:bg-(--color-accent-bg)/60 border-accent/25 text-accent'

export function getChatInputTileToneClass(
  tile: Pick<ChatInputTile, 'isNeutral'>,
): string {
  return tile.isNeutral ? NEUTRAL_TILE_TONE : ACCENT_TILE_TONE
}

export function getWebSearchProviderId(
  selected: WebSearchSelection,
): string | undefined {
  return WEB_SEARCH_PROVIDER_IDS[selected]
}

export function getWebSearchValueLabel(
  selected: Exclude<WebSearchSelection, 'off'>,
  exaSearchLevel: ExaSearchLevel,
): string {
  if (selected === 'web_search_exa') {
    return `Exa · ${EXA_SEARCH_LEVEL_LABELS[exaSearchLevel]}`
  }

  return WEB_SEARCH_SHORT_LABELS[selected]
}

export function getReasoningLevelLabel(
  level: ReasoningLevel,
  isToggleMode: boolean,
): string {
  if (isToggleMode && level !== 'off') {
    return 'On'
  }

  return REASONING_LEVEL_LABELS[level]
}

export function isAutoWebSearchActive(
  state: ChatInputToolsState['webSearch'],
): boolean {
  return state.selected !== 'off'
    && state.isAutoAvailable
    && state.isAutoPreferred
}

function buildProjectTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const project = state.project.context

  if (!project) {
    return null
  }

  return {
    id: 'project',
    section: 'project',
    icon: { kind: 'icon', name: 'lucide:folder' },
    caption: 'Project',
    value: project.name,
    chipLabel: project.name,
    ariaLabel: `Project: ${project.name}`,
    removeLabel: 'Remove project',
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
  }
}

function buildMemoryTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  if (state.memory.excluded !== true) {
    return null
  }

  return {
    id: 'memory',
    section: 'memory',
    icon: { kind: 'icon', name: CHAT_MEMORY_EXCLUSION_ICON },
    caption: 'Memory',
    value: 'Off',
    chipLabel: CHAT_MEMORY_OFF_LABEL,
    ariaLabel: `${CHAT_MEMORY_OFF_LABEL}. ${CHAT_MEMORY_EXCLUSION_HELPER}`,
    removeLabel: 'Use memory again',
    isNeutral: true,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
  }
}

function buildDeepResearchTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  if (!state.isDeepResearchModel) {
    return null
  }

  const estimate = state.research
    ? `${state.research.costEstimate} · ${state.research.timeEstimate}`
    : ''

  return {
    id: 'deep-research',
    section: null,
    icon: { kind: 'icon', name: 'lucide:telescope' },
    caption: 'Mode',
    value: 'Deep research',
    chipLabel: 'Deep research',
    ariaLabel: estimate
      ? `Deep research is on for this model — ${estimate}`
      : 'Deep research is on for this model',
    removeLabel: null,
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: state.isResearchJobActive,
  }
}

function buildImageTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  if (!state.image.enabled && !state.image.required) {
    return null
  }

  const isLocked = state.image.required

  return {
    id: 'image',
    section: 'image',
    icon: { kind: 'icon', name: 'lucide:image-plus' },
    caption: 'Mode',
    value: 'Image generation',
    chipLabel: 'Image generation',
    ariaLabel: isLocked
      ? 'Image generation is always on for this model'
      : 'Image generation is on',
    removeLabel: isLocked ? null : 'Turn off image generation',
    isNeutral: false,
    isAuto: false,
    isLocked,
    isDisabled: false,
  }
}

function buildSearchTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const { webSearch } = state

  if (!webSearch.visible || webSearch.selected === 'off') {
    return null
  }

  const isAuto = isAutoWebSearchActive(webSearch)
  const value = getWebSearchValueLabel(
    webSearch.selected,
    webSearch.exaSearchLevel,
  )
  const providerId = getWebSearchProviderId(webSearch.selected)

  return {
    id: 'search',
    section: 'search',
    icon: providerId
      ? { kind: 'provider', providerId }
      : { kind: 'icon', name: 'lucide:globe' },
    caption: isAuto ? 'Auto search' : 'Web search',
    value,
    chipLabel: `${isAuto ? 'Auto search' : 'Search'}: ${value}`,
    ariaLabel: `${isAuto ? 'Auto web search' : 'Web search'}: ${value}`,
    removeLabel: 'Turn off web search',
    isNeutral: false,
    isAuto,
    isLocked: false,
    isDisabled: false,
  }
}

function buildReasoningTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const { reasoning } = state

  if (!reasoning.visible || reasoning.mode !== 'configurable') {
    return null
  }

  const level = resolveSupportedReasoningLevel(
    reasoning.level,
    reasoning.capability,
  )
  const defaultLevel = reasoning.defaultLevel

  if (level === defaultLevel) {
    return null
  }

  const isToggleMode = reasoning.levels.length === 1
  const label = getReasoningLevelLabel(level, isToggleMode)
  const defaultLabel = getReasoningLevelLabel(defaultLevel, isToggleMode)

  return {
    id: 'reasoning',
    section: 'reasoning',
    icon: { kind: 'reasoning', level },
    caption: 'Reasoning',
    value: label,
    chipLabel: `Reasoning: ${label}`,
    ariaLabel: `Reasoning: ${label}. Your default is ${defaultLabel}.`,
    removeLabel: null,
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
  }
}

/**
 * The settings that differ from their defaults, in display order. Nothing is
 * returned until the model's capabilities resolve, so a saved choice the
 * model cannot honour never paints for a frame.
 */
export function buildChatInputTiles(
  state: ChatInputToolsState,
): ChatInputTile[] {
  if (!state.isCapabilityResolved) {
    return []
  }

  const builders = state.isDeepResearchModel
    ? [buildProjectTile, buildMemoryTile, buildDeepResearchTile]
    : [
      buildProjectTile,
      buildMemoryTile,
      buildImageTile,
      buildSearchTile,
      buildReasoningTile,
    ]

  return builders
    .map(builder => builder(state))
    .filter((tile): tile is ChatInputTile => tile !== null)
}
