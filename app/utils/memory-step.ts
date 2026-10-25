import type { UIMessage } from 'ai'
import type {
  MemoryCategory,
  MemorySensitiveCategory,
  MemorySensitivity,
} from '#shared/types/memory.d'
import {
  memoryCategories,
  memorySensitiveCategories,
  memorySensitivities,
} from '#shared/utils/memory-policy'
import type {
  MemoryStepAction,
  MemoryStepData,
  MemoryStepEntry,
  MemoryStepPrevious,
  MemoryStepScope,
  MemoryStepToolName,
} from '~/types/memory-step.d'
import type { SearchStepState } from '~/types/search-step.d'

export const MEMORY_STEP_MAX_ENTRIES = 10

const MEMORY_STEP_TOOL_NAMES = new Set<string>([
  'memory_list',
  'memory_read',
  'memory_write',
  'memory_forget',
])
const PENDING_STATES = new Set<string>(['input-streaming', 'input-available'])
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])
const MEMORY_CATEGORY_LABELS = new Map<string, string>([
  ['profile', 'Profile'],
  ['preferences', 'Preferences'],
  ['areas', 'Areas'],
  ['topics', 'Topics'],
  ['people', 'People'],
])

interface MemoryToolLikePart {
  type: string
  state?: string
  output?: unknown
  errorText?: unknown
  preliminary?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readCategory(value: unknown): MemoryCategory | null {
  if (typeof value !== 'string') {
    return null
  }

  return (memoryCategories as readonly string[]).includes(value)
    ? value as MemoryCategory
    : null
}

function readScope(value: unknown): MemoryStepScope {
  return value === 'project' ? 'project' : 'account'
}

function readEntryId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readEntry(value: unknown): MemoryStepEntry | null {
  const record = asRecord(value)
  const category = readCategory(record?.category)

  if (!record || !category || typeof record.title !== 'string') {
    return null
  }

  const title = record.title.trim()

  if (title.length === 0) {
    return null
  }

  return {
    title,
    category,
    scope: readScope(record.scope),
    id: readEntryId(record.id),
  }
}

function readEntryList(output: unknown): MemoryStepEntry[] {
  const entries = asRecord(output)?.entries

  if (!Array.isArray(entries)) {
    return []
  }

  const readable: MemoryStepEntry[] = []

  for (const entry of entries) {
    const readableEntry = readEntry(entry)

    if (readableEntry) {
      readable.push(readableEntry)
    }
  }

  return readable
}

function readSingleEntry(output: unknown, key: string): MemoryStepEntry[] {
  const entry = readEntry(asRecord(output)?.[key])

  return entry ? [entry] : []
}

function readStepEntries(
  toolName: string,
  output: unknown,
): MemoryStepEntry[] {
  if (toolName === 'memory_list') {
    return readEntryList(output)
  }

  if (toolName === 'memory_read') {
    return readSingleEntry(output, 'entry')
  }

  if (toolName === 'memory_write') {
    return readSingleEntry(output, 'entry')
  }

  return readSingleEntry(output, 'removed')
}

function readSensitivity(value: unknown): MemorySensitivity | undefined {
  return (memorySensitivities as readonly string[]).includes(value as string)
    ? value as MemorySensitivity
    : undefined
}

function readSensitiveCategory(
  value: unknown,
): MemorySensitiveCategory | null | undefined {
  if (value === null) {
    return null
  }

  return (memorySensitiveCategories as readonly string[])
    .includes(value as string)
    ? value as MemorySensitiveCategory
    : undefined
}

function readPrevious(value: unknown): MemoryStepPrevious | undefined {
  const record = asRecord(value)
  const category = readCategory(record?.category)

  if (
    !record
    || !category
    || typeof record.title !== 'string'
    || typeof record.description !== 'string'
    || typeof record.body !== 'string'
  ) {
    return undefined
  }

  const previous: MemoryStepPrevious = {
    category,
    title: record.title,
    description: record.description,
    body: record.body,
  }
  const sensitivity = readSensitivity(record.sensitivity)
  const sensitiveCategory = readSensitiveCategory(record.sensitiveCategory)

  if (sensitivity) {
    previous.sensitivity = sensitivity
  }

  if (sensitiveCategory !== undefined) {
    previous.sensitiveCategory = sensitiveCategory
  }

  return previous
}

function readAction(value: unknown): MemoryStepAction | undefined {
  return value === 'created' || value === 'updated' ? value : undefined
}

function resolveState(part: MemoryToolLikePart): SearchStepState {
  const state = part.state ?? ''

  if (FAILED_STATES.has(state)) {
    return 'failed'
  }

  if (
    PENDING_STATES.has(state)
    || (state === 'output-available' && part.preliminary === true)
  ) {
    return 'pending'
  }

  return 'done'
}

export function getMemoryStepData(
  part: UIMessage['parts'][number],
): MemoryStepData | null {
  const toolName = getToolPartName(part)

  if (!MEMORY_STEP_TOOL_NAMES.has(toolName)) {
    return null
  }

  const toolPart = part as MemoryToolLikePart
  const state = resolveState(toolPart)
  const hasOutput = toolPart.state === 'output-available'
    && toolPart.preliminary !== true
  const output = hasOutput ? toolPart.output : undefined
  const outputRecord = asRecord(output)
  const entries = hasOutput ? readStepEntries(toolName, output) : []
  const isWrite = toolName === 'memory_write'
  const action = isWrite ? readAction(outputRecord?.action) : undefined

  return {
    toolName: toolName as MemoryStepToolName,
    state,
    entries,
    action,
    entryId: isWrite ? entries[0]?.id : undefined,
    previous: action === 'updated'
      ? readPrevious(outputRecord?.previous)
      : undefined,
    errorReason: state === 'failed'
      ? getSearchStepErrorReason(toolPart.errorText)
      : '',
  }
}

export function formatMemoryEntryCount(count: number): string {
  if (count === 0) {
    return 'No entries'
  }

  return count === 1 ? '1 entry' : `${count} entries`
}

export function getMemoryCategoryLabel(category: string): string {
  return MEMORY_CATEGORY_LABELS.get(category) ?? category
}

export function canUndoMemoryStep(data: MemoryStepData): boolean {
  if (
    data.toolName !== 'memory_write'
    || data.state !== 'done'
    || !data.entryId
  ) {
    return false
  }

  if (data.action === 'created') {
    return true
  }

  return data.action === 'updated' && !!data.previous
}
