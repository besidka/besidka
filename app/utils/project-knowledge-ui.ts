import type {
  KnowledgeCharCounts,
  KnowledgeDecision,
  KnowledgeItem,
  KnowledgeMode,
  ProjectKnowledgeSummary,
} from '#shared/types/project-knowledge.d'
import { formatFileSize } from '#shared/utils/files'
import {
  KNOWLEDGE_LIMITS,
} from '#shared/utils/project-knowledge-policy'
import {
  decideKnowledgeMode,
  estimateKnowledgeTokens,
} from '#shared/utils/project-knowledge-budget'
import {
  estimatePromptCacheCost,
  formatApproxTokens,
  formatCostUsd,
} from '#shared/utils/prompt-cache-estimate'
import type {
  KnowledgeFolderNames,
  KnowledgeItemGroup,
  KnowledgeItemTypeLabel,
  KnowledgeMeterCopy,
  KnowledgeModelContext,
} from '~/types/knowledge-ui.d'

export interface KnowledgeMeterState {
  tokens: number
  budgetTokens: number
  contextWindow: number
  contextWindowKnown: boolean
  decision: KnowledgeDecision
  percentage: number
  fillPercentage: number
  isOverBudget: boolean
  perMessageCost: number | null
  perMessageCachedCost: number | null
}

const PDF_MEDIA_TYPE = 'application/pdf'
const DOCX_EXTENSION_PATTERN = /\.docx$/i
const SHEET_EXTENSION_PATTERN = /\.xlsx$/i
const PDF_EXTENSION_PATTERN = /\.pdf$/i
const TRAILING_ZERO_PATTERN = /\.0 /
const PERCENT = 100

const extractErrorMessages: Record<string, string> = {
  'ios-update-required': 'Update iOS to extract PDFs, or add it as a PDF '
    + 'for models that read PDFs.',
  'too-large': 'This file is too large to read.',
  'too-many-pages': 'This PDF has too many pages to read '
    + `(limit ${KNOWLEDGE_LIMITS.maxPdfPages}).`,
  'binary': 'This looks like a binary file, not text.',
  'not-utf8': 'This file is not valid UTF-8 text.',
  'unsupported': 'This file type is not supported.',
}

const GENERIC_EXTRACT_ERROR = 'Besidka could not read this file.'

export function getKnowledgeItemName(item: KnowledgeItem): string {
  return item.relativePath ?? item.title
}

export function getKnowledgeItemTypeLabel(
  item: KnowledgeItem,
): KnowledgeItemTypeLabel {
  if (item.kind === 'note') {
    return 'Note'
  }

  const name = getKnowledgeItemName(item)
  const mediaType = item.mediaType ?? ''

  if (
    mediaType === PDF_MEDIA_TYPE
    || PDF_EXTENSION_PATTERN.test(name)
    || item.extractor === 'client-unpdf'
    || item.extractor === 'worker-unpdf'
    || item.extractor === 'transcribed'
  ) {
    return 'PDF'
  }

  if (
    item.extractor === 'client-mammoth'
    || DOCX_EXTENSION_PATTERN.test(name)
  ) {
    return 'DOCX'
  }

  if (
    item.extractor === 'client-xlsx'
    || SHEET_EXTENSION_PATTERN.test(name)
  ) {
    return 'Sheet'
  }

  if (mediaType.startsWith('image/')) {
    return 'Image'
  }

  return 'Text'
}

export function isKnowledgePdf(item: KnowledgeItem): boolean {
  return getKnowledgeItemTypeLabel(item) === 'PDF'
    && item.fileId !== null
}

export function formatKnowledgeBytes(bytes: number): string {
  return formatFileSize(Math.max(0, bytes)).replace(TRAILING_ZERO_PATTERN, ' ')
}

export function describeKnowledgeExtractError(
  code: string | null,
): string {
  if (!code) {
    return GENERIC_EXTRACT_ERROR
  }

  if (/\s/.test(code)) {
    return code
  }

  return extractErrorMessages[code] ?? GENERIC_EXTRACT_ERROR
}

export function describeKnowledgeFailureDetails(failure: {
  why?: string | undefined
  fix?: string | undefined
}): string | undefined {
  const details = [failure.why, failure.fix].filter((detail) => {
    return Boolean(detail)
  })

  return details.length > 0 ? details.join(' ') : undefined
}

export function groupKnowledgeItems(
  items: KnowledgeItem[],
  folderNames: KnowledgeFolderNames = {},
): {
  groups: KnowledgeItemGroup[]
  looseItems: KnowledgeItem[]
} {
  const groupsById = new Map<string, KnowledgeItemGroup>()
  const looseItems: KnowledgeItem[] = []

  for (const item of items) {
    if (!item.folderId) {
      looseItems.push(item)

      continue
    }

    const existingGroup = groupsById.get(item.folderId)

    if (existingGroup) {
      existingGroup.items.push(item)

      continue
    }

    groupsById.set(item.folderId, {
      folderId: item.folderId,
      name: folderNames[item.folderId] ?? '',
      items: [item],
    })
  }

  const groups = Array.from(groupsById.values()).map((group, index) => {
    return {
      ...group,
      name: group.name || `Folder ${index + 1}`,
      items: [...group.items].sort((first, second) => {
        return getKnowledgeItemName(first)
          .localeCompare(getKnowledgeItemName(second))
      }),
    }
  })

  return { groups, looseItems }
}

function isActiveNativePdf(
  item: KnowledgeItem,
  model: KnowledgeModelContext,
): boolean {
  return model.acceptsPdf
    && item.sendAsNativePdf
    && isKnowledgePdf(item)
    && (item.pageCount ?? 0) > 0
}

function isActiveImage(
  item: KnowledgeItem,
  model: KnowledgeModelContext,
): boolean {
  return model.acceptsImages
    && item.fileId !== null
    && (item.mediaType ?? '').startsWith('image/')
}

function toCharCounts(item: KnowledgeItem): KnowledgeCharCounts {
  return {
    latinChars: item.latinChars,
    cyrillicChars: item.cyrillicChars,
    otherChars: item.otherChars,
  }
}

export function estimateKnowledgeItemTokens(
  item: KnowledgeItem,
  model: KnowledgeModelContext,
): number {
  if (isActiveNativePdf(item, model)) {
    return estimateKnowledgeTokens({
      counts: { latinChars: 0, cyrillicChars: 0, otherChars: 0 },
      family: model.family,
      media: { images: 0, nativePdfPages: item.pageCount ?? 0 },
    })
  }

  return estimateKnowledgeTokens({
    counts: toCharCounts(item),
    family: model.family,
    media: { images: isActiveImage(item, model) ? 1 : 0, nativePdfPages: 0 },
  })
}

export function computeKnowledgeMeter(input: {
  totals: ProjectKnowledgeSummary['totals']
  items: KnowledgeItem[]
  mode: KnowledgeMode
  model: KnowledgeModelContext
}): KnowledgeMeterState {
  const { totals, items, mode, model } = input
  const nativePdfItems = items.filter((item) => {
    return isActiveNativePdf(item, model)
  })
  const imageCount = items.filter((item) => {
    return isActiveImage(item, model)
  }).length
  const counts: KnowledgeCharCounts = {
    latinChars: totals.latinChars,
    cyrillicChars: totals.cyrillicChars,
    otherChars: totals.otherChars,
  }

  for (const item of nativePdfItems) {
    counts.latinChars = Math.max(0, counts.latinChars - item.latinChars)
    counts.cyrillicChars = Math.max(
      0,
      counts.cyrillicChars - item.cyrillicChars,
    )
    counts.otherChars = Math.max(0, counts.otherChars - item.otherChars)
  }

  const tokens = estimateKnowledgeTokens({
    counts,
    family: model.family,
    media: {
      images: Math.min(imageCount, KNOWLEDGE_LIMITS.maxFullInjectImages),
      nativePdfPages: nativePdfItems.reduce((sum, item) => {
        return sum + (item.pageCount ?? 0)
      }, 0),
    },
  })
  const decision = decideKnowledgeMode({
    mode,
    knowledgeTokens: tokens,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    messageTokens: 0,
    measuredHistoryTokens: null,
    estimatedSystemTokens: 0,
    estimatedHistoryTokens: 0,
    toolTokens: 0,
  })
  const percentage = decision.budgetTokens > 0
    ? Math.round(tokens / decision.budgetTokens * PERCENT)
    : 0
  const perMessageCost = model.inputPrice === null
    ? null
    : estimatePromptCacheCost({
      tokens,
      turns: 1,
      inputPrice: model.inputPrice,
    }).uncached
  const perMessageCachedCost = resolveCachedCost(tokens, model)

  return {
    tokens,
    budgetTokens: decision.budgetTokens,
    contextWindow: decision.contextWindow,
    contextWindowKnown: decision.contextWindowKnown,
    decision,
    percentage,
    fillPercentage: Math.min(PERCENT, percentage),
    isOverBudget: tokens > decision.budgetTokens,
    perMessageCost,
    perMessageCachedCost,
  }
}

function resolveCachedCost(
  tokens: number,
  model: KnowledgeModelContext,
): number | null {
  if (
    model.inputPrice === null
    || model.cacheReadPrice === null
    || !model.isCachingAvailable
  ) {
    return null
  }

  const pricing = {
    tokens,
    inputPrice: model.inputPrice,
    cacheReadPrice: model.cacheReadPrice,
  }
  const twoMessages = estimatePromptCacheCost({ ...pricing, turns: 2 })
  const oneMessage = estimatePromptCacheCost({ ...pricing, turns: 1 })

  return twoMessages.cached - oneMessage.cached
}

function formatApproxCost(amount: number): string {
  const formatted = formatCostUsd(amount)

  return formatted.startsWith('<') ? formatted : `≈ ${formatted}`
}

function describeCostLine(state: KnowledgeMeterState): string | null {
  if (state.perMessageCost === null) {
    return null
  }

  const perMessage = `${formatApproxCost(state.perMessageCost)} per message`

  if (state.perMessageCachedCost === null) {
    return perMessage
  }

  return `${perMessage}, ${
    formatApproxCost(state.perMessageCachedCost)
  } when cached`
}

function describeWindowNote(state: KnowledgeMeterState): string | null {
  if (state.contextWindowKnown) {
    return null
  }

  return `Context window unknown, assuming ${
    formatApproxTokens(state.contextWindow)
  }`
}

export function buildKnowledgeMeterCopy(input: {
  state: KnowledgeMeterState
  mode: KnowledgeMode
  modelName: string
}): KnowledgeMeterCopy {
  const { state, mode, modelName } = input
  const { decision } = state
  const budget = formatApproxTokens(state.budgetTokens)
  const headline = `Project knowledge · ${
    formatApproxTokens(state.tokens)
  } tokens`
  const windowNote = describeWindowNote(state)

  if (decision.reason === 'empty') {
    return {
      headline,
      barLabel: `Budget for ${modelName}: ${budget}`,
      summary: 'Nothing is sent yet',
      costLine: null,
      warning: windowNote,
    }
  }

  const barLabel = state.isOverBudget
    ? `over ${modelName}'s budget (${budget})`
    : `${state.percentage}% of ${modelName}'s full-context budget (${budget})`

  if (decision.mode === 'full') {
    return {
      headline,
      barLabel,
      summary: mode === 'full'
        ? 'Always include is on: all files are sent with every message'
        : 'All files are sent with every message',
      costLine: describeCostLine(state),
      warning: state.isOverBudget
        ? 'This is above the recommended budget for this model, so every '
        + 'message carries a lot of context.'
        : windowNote,
    }
  }

  if (mode === 'search') {
    return {
      headline,
      barLabel,
      summary: `Always search is on: ${modelName} searches the files `
        + 'when needed, nothing is added to every message',
      costLine: null,
      warning: windowNote,
    }
  }

  if (decision.notice === 'full-does-not-fit') {
    return {
      headline,
      barLabel: `does not fit ${modelName}'s context window`,
      summary: `${modelName} searches the files when needed · switch to `
        + 'a larger model to include everything',
      costLine: null,
      warning: 'Always include does not fit this model, so it searches '
        + 'instead.',
    }
  }

  return {
    headline,
    barLabel,
    summary: `${modelName} searches the files when needed · switch to a `
      + 'larger model to include everything',
    costLine: null,
    warning: windowNote,
  }
}
