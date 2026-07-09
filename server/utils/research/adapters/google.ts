import type {
  ResearchJobStatus,
  ResearchTraceEntry,
} from '#shared/types/research.d'
import {
  ResearchAdapterError,
  readResearchAdapterErrorBody,
} from '~~/server/utils/research/adapter-error'
import { buildResearcherDeveloperPrompt } from '~~/server/utils/research/prompts'
import { clampResearchTrace } from '~~/server/utils/research/trace'
import type {
  ResearchAdapter,
  ResearchFinalResult,
  ResearchSource,
  ResearchStartInput,
  ResearchStartResult,
  ResearchStatusResult,
} from '~~/server/utils/research/types.d'

const GOOGLE_INTERACTIONS_URL
  = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const GOOGLE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_GOOGLE_SOURCES = 200
const MAX_GOOGLE_SOURCE_RECURSION_DEPTH = 8
const MAX_GOOGLE_SOURCE_VISITED_NODES = 2000
const MAX_GOOGLE_TRACE_ENTRIES = 100
const MAX_GOOGLE_TRACE_RECURSION_DEPTH = 8
const MAX_GOOGLE_TRACE_VISITED_NODES = 2000

function validateGoogleJobId(providerJobId: string): void {
  if (!GOOGLE_JOB_ID_PATTERN.test(providerJobId)) {
    throw new Error(`Invalid Google research job id: ${providerJobId}`)
  }
}

function mapGoogleStatus(status: string): ResearchJobStatus {
  switch (status) {
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'incomplete':
    case 'budget_exceeded':
      return 'failed'
    default:
      return 'running'
  }
}

async function requestGoogle(
  path: string,
  apiKey: string,
  init: { method: string, body?: unknown },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${GOOGLE_INTERACTIONS_URL}${path}`, {
    method: init.method,
    headers: {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })

  if (!response.ok) {
    throw new ResearchAdapterError(
      response.status,
      await readResearchAdapterErrorBody(response),
    )
  }

  return await response.json() as Record<string, unknown>
}

async function start(
  input: ResearchStartInput,
): Promise<ResearchStartResult> {
  const developerPrompt = buildResearcherDeveloperPrompt(input.tier)
  const body = await requestGoogle('', input.apiKey, {
    method: 'POST',
    body: {
      input: `${developerPrompt}\n\n${input.brief}`,
      agent: input.modelId,
      background: true,
      store: true,
      agent_config: {
        type: 'deep-research',
        thinking_summaries: 'auto',
        collaborative_planning: false,
      },
    },
  })

  return {
    providerJobId: String(body.id),
    status: mapGoogleStatus(String(body.status)),
  }
}

async function status(
  providerJobId: string,
  apiKey: string,
): Promise<ResearchStatusResult> {
  validateGoogleJobId(providerJobId)

  const body = await requestGoogle(`/${providerJobId}`, apiKey, {
    method: 'GET',
  })

  return {
    status: mapGoogleStatus(String(body.status)),
    raw: body,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractGoogleReportText(steps: unknown[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]

    if (!isRecord(step)) {
      continue
    }

    const contentItems = Array.isArray(step.content) ? step.content : []
    const textItem = contentItems.find((item) => {
      return isRecord(item) && typeof item.text === 'string'
    })

    if (isRecord(textItem)) {
      return String(textItem.text)
    }
  }

  return ''
}

function collectGoogleSourceCandidates(
  value: unknown,
  seenUrls: Set<string>,
  sources: ResearchSource[],
  depth: number = 0,
  visited: { count: number } = { count: 0 },
): void {
  if (
    sources.length >= MAX_GOOGLE_SOURCES
    || depth > MAX_GOOGLE_SOURCE_RECURSION_DEPTH
    || visited.count >= MAX_GOOGLE_SOURCE_VISITED_NODES
    || !value
    || typeof value !== 'object'
  ) {
    return
  }

  visited.count += 1

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGoogleSourceCandidates(
        item, seenUrls, sources, depth + 1, visited,
      )
    }

    return
  }

  const record = value as Record<string, unknown>
  const url = typeof record.uri === 'string'
    ? record.uri
    : typeof record.url === 'string' ? record.url : undefined

  if (url && !seenUrls.has(url)) {
    seenUrls.add(url)
    sources.push({
      sourceId: `src-${sources.length}`,
      url,
      title: typeof record.title === 'string' ? record.title : undefined,
    })
  }

  for (const nestedValue of Object.values(record)) {
    collectGoogleSourceCandidates(
      nestedValue, seenUrls, sources, depth + 1, visited,
    )
  }
}

function extractGoogleSources(steps: unknown[]): ResearchSource[] {
  const lastStep = steps.at(-1)

  if (!isRecord(lastStep)) {
    return []
  }

  const seenUrls = new Set<string>()
  const sources: ResearchSource[] = []

  collectGoogleSourceCandidates(lastStep, seenUrls, sources)

  return sources
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function collectGoogleTraceCandidates(
  value: unknown,
  entries: ResearchTraceEntry[],
  depth: number = 0,
  visited: { count: number } = { count: 0 },
): void {
  if (
    entries.length >= MAX_GOOGLE_TRACE_ENTRIES
    || depth > MAX_GOOGLE_TRACE_RECURSION_DEPTH
    || visited.count >= MAX_GOOGLE_TRACE_VISITED_NODES
    || !value
    || typeof value !== 'object'
  ) {
    return
  }

  visited.count += 1

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGoogleTraceCandidates(item, entries, depth + 1, visited)
    }

    return
  }

  const record = value as Record<string, unknown>

  if (typeof record.query === 'string' && record.query) {
    entries.push({ kind: 'search', text: record.query })
  }

  const readUrl = typeof record.uri === 'string'
    ? record.uri
    : typeof record.url === 'string' ? record.url : undefined

  if (readUrl) {
    entries.push({ kind: 'read', text: readUrl })
  }

  for (const nestedValue of Object.values(record)) {
    collectGoogleTraceCandidates(nestedValue, entries, depth + 1, visited)
  }
}

function extractGoogleTrace(steps: unknown[]): ResearchTraceEntry[] {
  const entries: ResearchTraceEntry[] = []

  for (const step of steps) {
    if (!isRecord(step)) {
      continue
    }

    const contentItems = Array.isArray(step.content) ? step.content : []

    for (const item of contentItems) {
      if (isRecord(item) && typeof item.text === 'string' && item.text) {
        entries.push({ kind: 'thought', text: item.text })
      }
    }

    collectGoogleTraceCandidates(step, entries)
  }

  return entries
}

async function result(
  providerJobId: string,
  apiKey: string,
): Promise<ResearchFinalResult> {
  validateGoogleJobId(providerJobId)

  const body = await requestGoogle(`/${providerJobId}`, apiKey, {
    method: 'GET',
  })
  const steps = Array.isArray(body.steps) ? body.steps : []
  const reportText = extractGoogleReportText(steps)
  const sources = extractGoogleSources(steps)
  const usageRecord = isRecord(body.usage) ? body.usage : undefined
  const trace = clampResearchTrace(extractGoogleTrace(steps))

  return {
    reportText,
    sources,
    usage: usageRecord
      ? {
        inputTokens: toNumber(
          usageRecord.input_tokens ?? usageRecord.inputTokens,
        ),
        outputTokens: toNumber(
          usageRecord.output_tokens ?? usageRecord.outputTokens,
        ),
        totalTokens: toNumber(
          usageRecord.total_tokens ?? usageRecord.totalTokens,
        ),
      }
      : undefined,
    trace,
  }
}

async function cancel(providerJobId: string, apiKey: string): Promise<void> {
  validateGoogleJobId(providerJobId)

  const response = await fetch(
    `${GOOGLE_INTERACTIONS_URL}/${providerJobId}/cancel`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
      },
    },
  )

  if (!response.ok && response.status !== 404) {
    throw new ResearchAdapterError(
      response.status,
      await readResearchAdapterErrorBody(response),
    )
  }
}

export const googleResearchAdapter: ResearchAdapter = {
  start,
  status,
  result,
  cancel,
}
