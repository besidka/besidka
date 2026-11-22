import { desc, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import type {
  MessageUsage,
  SearchBillingUnit,
} from '#shared/types/message-usage.d'
import { CHAT_CONTEXT_MAX_MESSAGES } from '#shared/utils/chat-context'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import {
  formatMessageCost,
  formatSearchGroundingUnits,
} from '#shared/utils/message-format'
import {
  getChatTotalCost,
  getFollowingAssistantUsage,
  getPerMessageCost,
  getPerMessageSearchCost,
  hasUnknownTokenSplit,
  hydrateMessageUsage,
} from '#shared/utils/message-metadata'
import type { DisplayCost } from '#shared/utils/message-metadata'
import * as schema from '~~/server/db/schema'
import {
  fitReportLine,
  formatReportCount,
  formatReportDateTime,
  formatReportSpan,
  reportRow,
  reportRule,
} from '~~/server/utils/usage/report-text'

type DbClient = ReturnType<typeof useDb>

export interface ChatCostModel {
  model: string
  provider: string
  replies: number
  uncachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  unsplitTokens: number
  cost: number | null
  isBlended: boolean
  isEstimated: boolean
}

export interface ChatCostSearch {
  provider: string
  units: number
  billingUnit: SearchBillingUnit | null
  cost: number
}

export interface ChatCost {
  slug: string
  messages: number
  truncated: boolean
  firstMessageAt: string | null
  lastMessageAt: string | null
  models: ChatCostModel[]
  searches: ChatCostSearch[]
  total: DisplayCost | null
}

interface CostRow {
  role: string
  usage: MessageUsage | null
  createdAt: Date | null
}

function emptyModel(usage: MessageUsage): ChatCostModel {
  return {
    model: usage.model,
    provider: usage.provider,
    replies: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    unsplitTokens: 0,
    cost: null,
    isBlended: false,
    isEstimated: false,
  }
}

function addTokens(model: ChatCostModel, usage: MessageUsage) {
  model.replies += 1

  if (hasUnknownTokenSplit(usage)) {
    model.unsplitTokens += usage.totalTokens

    return
  }

  const cacheRead = usage.cachedInputTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0

  model.uncachedInputTokens += Math.max(
    0,
    usage.inputTokens - cacheRead - cacheWrite,
  )
  model.cacheReadTokens += cacheRead
  model.cacheWriteTokens += cacheWrite
  model.outputTokens += usage.outputTokens
  model.reasoningTokens += usage.reasoningTokens ?? 0
}

function addCost(model: ChatCostModel, cost: DisplayCost) {
  model.cost = (model.cost ?? 0) + cost.amount
  model.isEstimated = model.isEstimated || cost.isEstimated
}

/**
 * The cost of one chat by model, worked out with the same per-message rules
 * as the chat panel's cost badge (`getPerMessageCost`,
 * `getPerMessageSearchCost`, `getChatTotalCost` over the same newest
 * `CHAT_CONTEXT_MAX_MESSAGES` rows), so `/cost` and the badge always show
 * the same total. Input tokens are split into uncached, cache read and
 * cache write, because `inputTokens` already includes both cache buckets.
 */
export function summarizeChatCost(
  slug: string,
  rows: readonly CostRow[],
  truncated: boolean,
): ChatCost {
  const persisted = rows.filter(row => isPersistedMessageRole(row.role))
  const messages = persisted.map((row) => {
    return hydrateMessageUsage({
      role: row.role,
      parts: [],
      usage: row.usage,
      createdAt: row.createdAt ?? undefined,
    })
  })
  const models = new Map<string, ChatCostModel>()
  const searches = new Map<string, ChatCostSearch>()

  function modelEntry(usage: MessageUsage): ChatCostModel {
    const key = `${usage.provider}\u0000${usage.model}`
    let entry = models.get(key)

    if (!entry) {
      entry = emptyModel(usage)
      models.set(key, entry)
    }

    return entry
  }

  messages.forEach((message, index) => {
    const usage = message.role === 'assistant'
      ? message.usage ?? undefined
      : getFollowingAssistantUsage(messages, index)

    if (!usage) {
      return
    }

    const entry = modelEntry(usage)

    if (message.role === 'assistant') {
      addTokens(entry, usage)
      entry.isBlended = entry.isBlended || usage.totalCost !== undefined
    }

    const cost = getPerMessageCost(messages, index)

    if (cost) {
      addCost(entry, cost)
    }

    const searchCost = getPerMessageSearchCost(messages, index)

    if (!searchCost) {
      return
    }

    const provider = usage.searchProvider ?? 'web'
    const search = searches.get(provider) ?? {
      provider,
      units: 0,
      billingUnit: usage.searchBillingUnit ?? null,
      cost: 0,
    }

    search.units += usage.searchUnits ?? 0
    search.cost += searchCost.amount
    searches.set(provider, search)
  })

  const dates = persisted
    .map(row => row.createdAt)
    .filter((date): date is Date => date instanceof Date)
  const first = dates[0] ?? null
  const last = dates.at(-1) ?? null

  return {
    slug,
    messages: persisted.length,
    truncated,
    firstMessageAt: first?.toISOString() ?? null,
    lastMessageAt: last?.toISOString() ?? null,
    models: [...models.values()].sort((left, right) => {
      return (right.cost ?? 0) - (left.cost ?? 0)
        || left.model.localeCompare(right.model)
    }),
    searches: [...searches.values()].sort((left, right) => {
      return left.provider.localeCompare(right.provider)
    }),
    total: getChatTotalCost(messages) ?? null,
  }
}

/**
 * Reads the cost of one of the user's chats. A chat that is not the user's
 * is the same 404 as a missing one.
 */
export async function getChatCost(
  db: DbClient,
  userId: number,
  slug: string,
): Promise<ChatCost> {
  const chat = await db.query.chats.findFirst({
    where: { slug, userId },
    columns: { id: true, slug: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found. Call list_chats to find one.',
      status: 404,
      why: 'The chat does not exist or is not yours',
      fix: 'Check the chat slug',
    })
  }

  const rows = await db.select({
    role: schema.messages.role,
    usage: schema.messages.usage,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chat.id))
    .orderBy(desc(schema.messages.id))
    .limit(CHAT_CONTEXT_MAX_MESSAGES + 1)
  const truncated = rows.length > CHAT_CONTEXT_MAX_MESSAGES

  return summarizeChatCost(
    chat.slug,
    rows.slice(0, CHAT_CONTEXT_MAX_MESSAGES).reverse().map((row) => {
      return { ...row, usage: row.usage ?? null }
    }),
    truncated,
  )
}

const SEARCH_PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  brave: 'Brave',
  exa: 'Exa',
  web: 'Web',
}

function formatCost(cost: number | null, isEstimated: boolean): string {
  return cost === null ? 'no price' : formatMessageCost(cost, isEstimated)
}

/**
 * The `/cost` report: one plain-text block of rows at most `REPORT_WIDTH`
 * characters wide. Every amount is an estimate from public prices; a `~`
 * marks one that includes a search or research estimate.
 */
export function formatChatCostReport(cost: ChatCost): string {
  const lines: string[] = ['Chat cost (estimated)', reportRule()]
  const first = cost.firstMessageAt ? new Date(cost.firstMessageAt) : null
  const last = cost.lastMessageAt ? new Date(cost.lastMessageAt) : null

  lines.push(reportRow(
    'Messages',
    `${formatReportCount(cost.messages)}${cost.truncated ? ' (newest)' : ''}`,
  ))

  if (first && last) {
    lines.push(reportRow('First', `${formatReportDateTime(first)} UTC`))
    lines.push(reportRow('Last', `${formatReportDateTime(last)} UTC`))
    lines.push(reportRow(
      'Span',
      formatReportSpan(last.getTime() - first.getTime()),
    ))
  }

  if (cost.models.length === 0) {
    lines.push('', 'No model replies with usage yet.')
  }

  for (const model of cost.models) {
    lines.push('', fitReportLine(model.model), fitReportLine(`  via ${model.provider}`))
    lines.push(reportRow('Replies', formatReportCount(model.replies), 2))
    lines.push(reportRow(
      'Input',
      formatReportCount(model.uncachedInputTokens),
      2,
    ))
    lines.push(reportRow('Output', formatReportCount(model.outputTokens), 2))

    if (model.reasoningTokens > 0) {
      lines.push(reportRow(
        'incl. reasoning',
        formatReportCount(model.reasoningTokens),
        4,
      ))
    }

    if (model.cacheReadTokens > 0) {
      lines.push(reportRow(
        'Cache read',
        formatReportCount(model.cacheReadTokens),
        2,
      ))
    }

    if (model.cacheWriteTokens > 0) {
      lines.push(reportRow(
        'Cache write',
        formatReportCount(model.cacheWriteTokens),
        2,
      ))
    }

    if (model.unsplitTokens > 0) {
      lines.push(reportRow(
        'Tokens, no split',
        formatReportCount(model.unsplitTokens),
        2,
      ))
    }

    lines.push(reportRow(
      model.isBlended ? 'Cost (blended)' : 'Cost',
      formatCost(model.cost, model.isEstimated),
      2,
    ))
  }

  for (const search of cost.searches) {
    const label = SEARCH_PROVIDER_LABELS[search.provider] ?? search.provider

    lines.push('', `Web search, ${label}`)
    lines.push(reportRow(
      formatSearchGroundingUnits(search.units, search.billingUnit ?? undefined)
      || 'Searches',
      formatMessageCost(search.cost, true),
      2,
    ))
  }

  lines.push('', reportRule())
  lines.push(reportRow(
    'Total',
    cost.total
      ? formatMessageCost(cost.total.amount, cost.total.isEstimated)
      : 'no price',
  ))
  lines.push(
    'Estimated from public prices.',
    'The provider\'s bill is authoritative.',
  )

  return lines.join('\n')
}
