import type { UIMessage } from 'ai'
import { SEARCH_FRESHNESS_WINDOW_DAYS } from '#shared/utils/search-freshness'
import type {
  SearchStepData,
  SearchStepFreshness,
  SearchStepResult,
  SearchStepState,
} from '~/types/search-step.d'

export const SEARCH_STEP_MAX_RESULTS = 10
export const SEARCH_STEP_FALLBACK_ERROR = 'The search failed.'

const SEARCH_STEP_TOOL_NAMES = new Set<string>([
  'web_search_brave',
  'web_search_exa',
])
const SEARCH_STEP_FRESHNESS_LABELS = new Map<SearchStepFreshness, string>([
  ['day', 'Last 24 hours'],
  ['week', 'Last 7 days'],
  ['month', 'Last month'],
  ['year', 'Last 12 months'],
])
const SEARCH_STEP_FRESHNESS_WINDOW_PHRASES = new Map<
  SearchStepFreshness,
  string
>([
  ['day', 'in the last 24 hours'],
  ['week', 'in the last 7 days'],
  ['month', 'in the last month'],
  ['year', 'in the last 12 months'],
])
const MILLISECONDS_PER_DAY = 86_400_000
const DATE_ONLY_LENGTH = 10
const RESULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}
const LOCAL_RESULT_DATE_FORMATTER = new Intl.DateTimeFormat(
  undefined,
  RESULT_DATE_OPTIONS,
)
const UTC_RESULT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  ...RESULT_DATE_OPTIONS,
  timeZone: 'UTC',
})
const ERROR_TEXT_LENGTH_LIMIT = 300
const PENDING_STATES = new Set<string>(['input-streaming', 'input-available'])
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])

interface SearchToolLikePart {
  type: string
  state?: string
  input?: unknown
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

function readFreshness(value: unknown): SearchStepFreshness | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return SEARCH_STEP_FRESHNESS_LABELS.has(value as SearchStepFreshness)
    ? value as SearchStepFreshness
    : undefined
}

function readResults(output: unknown): SearchStepResult[] {
  const results = asRecord(output)?.results

  if (!Array.isArray(results)) {
    return []
  }

  const readable: SearchStepResult[] = []

  for (const entry of results) {
    const record = asRecord(entry)

    if (!record || typeof record.url !== 'string') {
      continue
    }

    readable.push({
      title: typeof record.title === 'string' ? record.title : '',
      url: record.url,
      publishedDate: typeof record.publishedDate === 'string'
        ? record.publishedDate
        : undefined,
    })
  }

  return readable
}

function resolveState(part: SearchToolLikePart): SearchStepState {
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

/**
 * Reads the human reason out of a tool `errorText`. The chat stream encodes
 * failures as a JSON `ChatErrorPayload`, so `message` and `why` are joined;
 * plain text is shown as-is (clipped), and anything unreadable falls back to
 * a generic sentence instead of leaking raw JSON.
 */
export function getSearchStepErrorReason(errorText: unknown): string {
  if (typeof errorText !== 'string' || errorText.trim().length === 0) {
    return SEARCH_STEP_FALLBACK_ERROR
  }

  const trimmed = errorText.trim()

  if (!trimmed.startsWith('{')) {
    return trimmed.slice(0, ERROR_TEXT_LENGTH_LIMIT)
  }

  try {
    const payload = asRecord(JSON.parse(trimmed))
    const message = typeof payload?.message === 'string'
      ? payload.message.trim()
      : ''
    const why = typeof payload?.why === 'string' ? payload.why.trim() : ''

    return [message, why]
      .filter((line) => {
        return line.length > 0
      })
      .join(' ')
      .slice(0, ERROR_TEXT_LENGTH_LIMIT)
      || SEARCH_STEP_FALLBACK_ERROR
  } catch {
    return trimmed.slice(0, ERROR_TEXT_LENGTH_LIMIT)
  }
}

export function getSearchStepData(
  part: UIMessage['parts'][number],
): SearchStepData | null {
  const toolPart = part as SearchToolLikePart
  const toolName = getToolPartName(part)

  if (!SEARCH_STEP_TOOL_NAMES.has(toolName)) {
    return null
  }

  const input = asRecord(toolPart.input)
  const state = resolveState(toolPart)
  const hasOutput = toolPart.state === 'output-available'
    && toolPart.preliminary !== true

  return {
    toolName: toolName as SearchStepData['toolName'],
    state,
    query: typeof input?.query === 'string' ? input.query.trim() : '',
    freshness: readFreshness(input?.freshness),
    results: hasOutput ? readResults(toolPart.output) : [],
    hasOutput,
    errorReason: state === 'failed'
      ? getSearchStepErrorReason(toolPart.errorText)
      : '',
  }
}

export function getSearchFreshnessLabel(
  freshness: SearchStepFreshness,
): string {
  return SEARCH_STEP_FRESHNESS_LABELS.get(freshness) ?? freshness
}

export function getSearchFreshnessTooltip(
  freshness: SearchStepFreshness,
  searchedAt?: string | number | Date | null,
): string {
  const searchedAtDate = searchedAt === undefined || searchedAt === null
    ? null
    : new Date(searchedAt)

  if (searchedAtDate && !Number.isNaN(searchedAtDate.getTime())) {
    const windowMilliseconds = SEARCH_FRESHNESS_WINDOW_DAYS[freshness]
      * MILLISECONDS_PER_DAY
    const cutoff = new Date(searchedAtDate.getTime() - windowMilliseconds)

    return `Only pages published since ${
      LOCAL_RESULT_DATE_FORMATTER.format(cutoff)
    }`
  }

  const windowPhrase = SEARCH_STEP_FRESHNESS_WINDOW_PHRASES.get(freshness)

  return `Only pages published ${windowPhrase}`
}

export function formatSearchResultDate(publishedDate: string): string {
  const date = new Date(publishedDate)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const isDateOnly = publishedDate.trim().length === DATE_ONLY_LENGTH

  const formatter = isDateOnly
    ? UTC_RESULT_DATE_FORMATTER
    : LOCAL_RESULT_DATE_FORMATTER

  return formatter.format(date)
}

export function formatSearchResultCount(count: number): string {
  if (count === 0) {
    return 'No results'
  }

  return count === 1 ? '1 result' : `${count} results`
}
