import type { ReasoningLevel } from '#shared/types/reasoning.d'
import {
  EXA_SEARCH_LEVEL_LABELS,
  type ExaSearchLevel,
} from '#shared/utils/exa-search-level'
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { resolveSupportedReasoningLevel } from '#shared/utils/reasoning'
import type {
  ChatInputTile,
  ChatInputToolsState,
} from '~/types/chat-input-tools'
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
} from '~/utils/artifact-parts'
import type { WebSearchSelection } from '~/types/web-search'
import {
  CODE_EXECUTION_TOOL_ICON,
  CODE_EXECUTION_TOOL_LABEL,
} from '~/utils/code-execution-ui'
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

const ACCENT_TILE_TONE = 'bg-accent/10 dark:bg-(--color-accent-bg)/60 '
  + 'border-accent/25 text-(--color-accent-text) dark:text-accent'

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
    section: 'add',
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

function buildCodeExecutionTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const { codeExecution } = state

  if (!codeExecution?.visible || !codeExecution.enabled) {
    return null
  }

  return {
    id: 'code',
    section: 'code',
    icon: { kind: 'icon', name: CODE_EXECUTION_TOOL_ICON },
    caption: 'Mode',
    value: CODE_EXECUTION_TOOL_LABEL,
    chipLabel: CODE_EXECUTION_TOOL_LABEL,
    ariaLabel: `${CODE_EXECUTION_TOOL_LABEL} is on for the next message`,
    removeLabel: 'Turn off run code',
    isNeutral: false,
    isAuto: false,
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

function buildSkillTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const selected = state.skills?.selected

  if (!state.skills?.visible || !selected) {
    return null
  }

  return {
    id: 'skill',
    section: 'skills',
    icon: { kind: 'icon', name: 'lucide:sparkles' },
    caption: 'Skill',
    value: selected.name,
    chipLabel: `Skill: ${selected.name}`,
    ariaLabel: `Skill ${selected.name} is attached to the next message. `
      + 'Open to read it.',
    removeLabel: `Remove skill ${selected.name}`,
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
  }
}

export function countSelectedConnectors(
  connectors: ChatInputToolsState['connectors'],
): number {
  if (!connectors) {
    return 0
  }

  const manualItemIds = new Set(
    connectors.items
      .filter(item => item.toolMode === 'manual')
      .map(item => item.id),
  )

  return connectors.selectedIds.filter(id => manualItemIds.has(id)).length
}

function buildConnectorsTile(
  state: ChatInputToolsState,
): ChatInputTile | null {
  const connectors = state.connectors

  if (!connectors?.visible) {
    return null
  }

  const selectedItems = connectors.items.filter((item) => {
    return item.toolMode === 'manual'
      && connectors.selectedIds.includes(item.id)
  })
  const count = countSelectedConnectors(connectors)

  if (count === 0) {
    return null
  }

  const singleTitle = count === 1 ? selectedItems[0]?.title.trim() : ''
  const label = count === 1 ? '1 connector' : `${count} connectors`

  return {
    id: 'connectors',
    section: 'connectors',
    icon: { kind: 'icon', name: 'lucide:cable' },
    caption: 'Connectors',
    value: singleTitle || String(count),
    chipLabel: singleTitle || label,
    ariaLabel: singleTitle
      ? `Connector ${singleTitle} is on for this chat. Open to change.`
      : `${label} on for this chat. Open to change.`,
    removeLabel: 'Turn off connectors',
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: false,
  }
}

export const ARTIFACT_TILE_ID_PREFIX = 'artifact-'

function buildArtifactTiles(state: ChatInputToolsState): ChatInputTile[] {
  if (!state.artifacts.visible) {
    return []
  }

  return state.artifacts.attached.map((artifact) => {
    const kindLabel = ARTIFACT_KIND_LABELS[artifact.kind]

    return {
      id: `${ARTIFACT_TILE_ID_PREFIX}${artifact.artifactId}`,
      section: 'add',
      icon: { kind: 'icon', name: ARTIFACT_KIND_ICONS[artifact.kind] },
      caption: kindLabel,
      value: artifact.title,
      chipLabel: `Artifact: ${artifact.title}`,
      ariaLabel: `Attached artifact: ${artifact.title}, `
        + `${kindLabel}, version ${artifact.version}`,
      removeLabel: `Remove ${artifact.title}`,
      isNeutral: false,
      isAuto: false,
      isLocked: false,
      isDisabled: false,
    }
  })
}

export const GOOGLE_FILE_TILE_ID = 'google-file'
export const GOOGLE_FILE_TILE_CAPTION = 'Google Drive'

/**
 * The tile that offers the Google files a pasted link names, one for all of
 * them, first in the row and in the same accent look as the setting tiles.
 * Tapping it opens the Picker on those files; its remove button dismisses
 * the offer for this message. It is not a setting, so `buildChatInputTiles`
 * never returns it and the tools menu never repeats it; the composer puts it
 * at the front of the row.
 */
export function buildGoogleLinkTile(
  count: number,
  isBusy: boolean,
): ChatInputTile | null {
  if (count <= 0) {
    return null
  }

  const isSingle = count === 1
  const value = isSingle ? 'Attach file' : `Attach ${count} files`

  return {
    id: GOOGLE_FILE_TILE_ID,
    section: null,
    icon: { kind: 'icon', name: GOOGLE_DRIVE_ICON },
    caption: GOOGLE_FILE_TILE_CAPTION,
    value,
    chipLabel: `${GOOGLE_FILE_TILE_CAPTION}: ${value}`,
    ariaLabel: isSingle
      ? 'Attach the Google file from the link'
      : 'Attach the Google files from the links',
    removeLabel: isSingle
      ? 'Dismiss the Google file suggestion'
      : 'Dismiss the Google file suggestions',
    isNeutral: false,
    isAuto: false,
    isLocked: false,
    isDisabled: isBusy,
  }
}

/**
 * The settings that differ from their defaults, in display order. Nothing is
 * returned until the model's capabilities resolve, so a saved choice the
 * model cannot honor never paints for a frame.
 */
export function buildChatInputTiles(
  state: ChatInputToolsState,
): ChatInputTile[] {
  const skillTiles = [buildSkillTile(state)]
    .filter((tile): tile is ChatInputTile => tile !== null)

  if (!state.isCapabilityResolved) {
    return [...skillTiles, ...buildArtifactTiles(state)]
  }

  const builders = state.isDeepResearchModel
    ? [buildProjectTile, buildMemoryTile, buildDeepResearchTile]
    : [
      buildProjectTile,
      buildMemoryTile,
      buildImageTile,
      buildSearchTile,
      buildCodeExecutionTile,
      buildReasoningTile,
      buildConnectorsTile,
    ]

  const settingTiles = builders
    .map(builder => builder(state))
    .filter((tile): tile is ChatInputTile => tile !== null)

  return [...settingTiles, ...skillTiles, ...buildArtifactTiles(state)]
}
