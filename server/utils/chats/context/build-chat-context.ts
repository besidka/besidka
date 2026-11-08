import type {
  ChatContextCounts,
  ChatContextGroup,
  ChatContextItem,
  ChatContextItemKind,
} from '#shared/types/chat-context.d'
import { CHAT_CONTEXT_MAX_ITEMS_PER_GROUP } from '#shared/utils/chat-context'
import type {
  ChatContextAccumulator,
  ChatContextMessage,
  ChatContextSection,
  ChatContextVisibility,
} from '~~/server/utils/chats/context/sections'
import {
  CHAT_CONTEXT_SECTIONS,
  getContextPartToolName,
} from '~~/server/utils/chats/context/sections'

export interface ChatContextItems {
  outputs: ChatContextItem[]
  inputs: ChatContextItem[]
  used: ChatContextItem[]
  counts: ChatContextCounts
  kindCounts: Partial<Record<ChatContextItemKind, number>>
  truncated: boolean
}

export const MCP_CONTEXT_FILES_LIMIT = 20

export { CHAT_CONTEXT_MAX_ITEMS_PER_GROUP }

function createAccumulator() {
  const groups: Record<ChatContextGroup, Map<string, ChatContextItem>> = {
    outputs: new Map(),
    inputs: new Map(),
    used: new Map(),
  }

  const accumulator: ChatContextAccumulator = {
    add(group, item) {
      if (!groups[group].has(item.id)) {
        groups[group].set(item.id, item)
      }
    },
    increment(group, item) {
      const existing = groups[group].get(item.id)

      if (existing) {
        existing.meta = {
          ...existing.meta,
          count: (existing.meta?.count ?? 1) + 1,
        }

        return
      }

      groups[group].set(item.id, {
        ...item,
        meta: { ...item.meta, count: 1 },
      })
    },
  }

  return { groups, accumulator }
}

/**
 * Builds the chat context panel's Outputs, Inputs and Used lists from
 * persisted message parts, in message order, deduplicated per item id. The
 * public variant runs only sections that may appear on a shared chat, and the
 * caller must pass parts that already went through `filterPublicParts`.
 */
export function buildChatContext(
  messages: readonly ChatContextMessage[],
  options: {
    visibility: ChatContextVisibility
    sections?: readonly ChatContextSection[]
    truncated?: boolean
  },
): ChatContextItems {
  const sections = (options.sections ?? CHAT_CONTEXT_SECTIONS)
    .filter((section) => {
      return options.visibility === 'private'
        || section.visibility === 'public'
    })
  const { groups, accumulator } = createAccumulator()

  for (const message of messages) {
    const scopedMessage = options.visibility === 'public'
      ? withoutToolParts(message)
      : message

    for (const section of sections) {
      section.collect(scopedMessage, accumulator)
    }
  }

  const outputs = Array.from(groups.outputs.values())
  const inputs = Array.from(groups.inputs.values())
  const used = Array.from(groups.used.values())

  return {
    outputs: keepNewest(outputs),
    inputs: keepNewest(inputs),
    used: keepNewest(used),
    counts: {
      outputs: outputs.length,
      inputs: inputs.length,
      used: used.length,
    },
    kindCounts: countKinds([...outputs, ...inputs, ...used]),
    truncated: options.truncated === true,
  }
}

function keepNewest(items: ChatContextItem[]): ChatContextItem[] {
  return items.length > CHAT_CONTEXT_MAX_ITEMS_PER_GROUP
    ? items.slice(-CHAT_CONTEXT_MAX_ITEMS_PER_GROUP)
    : items
}

function countKinds(
  items: ChatContextItem[],
): Partial<Record<ChatContextItemKind, number>> {
  const counts: Partial<Record<ChatContextItemKind, number>> = {}

  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1
  }

  return counts
}

function withoutToolParts(message: ChatContextMessage): ChatContextMessage {
  return {
    ...message,
    tools: undefined,
    parts: message.parts.filter((part) => {
      return getContextPartToolName(part) === null
    }),
  }
}

function getStorageKey(url: string | undefined): string | null {
  if (!url) {
    return null
  }

  const match = /^\/files\/([^/?#]+)/.exec(url)

  return match?.[1] ?? null
}

export interface McpChatContextSummary {
  outputs: number
  inputs: number
  sources: number
  images: number
  researchReports: number
  memoryActions: number
  truncated: boolean
  files: Array<{ storageKey: string, name: string }>
}

export function summarizeChatContextForMcp(
  context: ChatContextItems,
): McpChatContextSummary {
  const files = context.inputs
    .flatMap((item) => {
      const storageKey = item.kind === 'file'
        ? getStorageKey(item.meta?.url)
        : null

      return storageKey ? [{ storageKey, name: item.title }] : []
    })
    .slice(0, MCP_CONTEXT_FILES_LIMIT)

  return {
    outputs: context.counts.outputs,
    inputs: context.counts.inputs,
    sources: context.kindCounts['web-source'] ?? 0,
    images: context.kindCounts.image ?? 0,
    researchReports: context.kindCounts.research ?? 0,
    memoryActions: context.kindCounts.memory ?? 0,
    truncated: context.truncated,
    files,
  }
}
