import type { ResearchJobStatus } from '#shared/types/research.d'
import {
  ResearchAdapterError,
  readResearchAdapterErrorBody,
} from '~~/server/utils/research/adapter-error'
import { buildResearcherDeveloperPrompt } from '~~/server/utils/research/prompts'
import type {
  ResearchAdapter,
  ResearchFinalResult,
  ResearchSource,
  ResearchStartInput,
  ResearchStartResult,
  ResearchStatusResult,
} from '~~/server/utils/research/types.d'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_JOB_ID_PATTERN = /^resp_[A-Za-z0-9_-]{1,128}$/
const DEFAULT_MAX_TOOL_CALLS = 30

function validateOpenAiJobId(providerJobId: string): void {
  if (!OPENAI_JOB_ID_PATTERN.test(providerJobId)) {
    throw new Error(`Invalid OpenAI research job id: ${providerJobId}`)
  }
}

function mapOpenAiStatus(status: string): ResearchJobStatus {
  switch (status) {
    case 'queued':
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
    case 'incomplete':
      return 'failed'
    default:
      return 'running'
  }
}

async function requestOpenAi(
  path: string,
  apiKey: string,
  init: { method: string, body?: unknown },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${OPENAI_RESPONSES_URL}${path}`, {
    method: init.method,
    headers: {
      'authorization': `Bearer ${apiKey}`,
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
  const body = await requestOpenAi('', input.apiKey, {
    method: 'POST',
    body: {
      model: input.modelId,
      background: true,
      store: true,
      max_tool_calls: input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      reasoning: { summary: 'auto' },
      tools: [{ type: 'web_search_preview' }],
      input: [
        {
          role: 'developer',
          content: [{
            type: 'input_text',
            text: buildResearcherDeveloperPrompt(input.tier),
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: input.brief }],
        },
      ],
    },
  })

  return {
    providerJobId: String(body.id),
    status: mapOpenAiStatus(String(body.status)),
  }
}

async function status(
  providerJobId: string,
  apiKey: string,
): Promise<ResearchStatusResult> {
  validateOpenAiJobId(providerJobId)

  const body = await requestOpenAi(`/${providerJobId}`, apiKey, {
    method: 'GET',
  })

  return {
    status: mapOpenAiStatus(String(body.status)),
    raw: body,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractOpenAiSources(
  textItems: Record<string, unknown>[],
): ResearchSource[] {
  const seenUrls = new Set<string>()
  const sources: ResearchSource[] = []

  for (const item of textItems) {
    const annotations = Array.isArray(item.annotations)
      ? item.annotations
      : []

    for (const annotation of annotations) {
      if (!isRecord(annotation)) {
        continue
      }

      const url = typeof annotation.url === 'string'
        ? annotation.url
        : undefined

      if (!url || seenUrls.has(url)) {
        continue
      }

      seenUrls.add(url)
      sources.push({
        sourceId: `src-${sources.length}`,
        url,
        title: typeof annotation.title === 'string'
          ? annotation.title
          : undefined,
      })
    }
  }

  return sources
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

async function result(
  providerJobId: string,
  apiKey: string,
): Promise<ResearchFinalResult> {
  validateOpenAiJobId(providerJobId)

  const body = await requestOpenAi(`/${providerJobId}`, apiKey, {
    method: 'GET',
  })
  const output = Array.isArray(body.output) ? body.output : []
  const messageItems = output.filter((
    item,
  ): item is Record<string, unknown> => {
    return isRecord(item) && item.type === 'message'
  })
  const lastMessage = messageItems.at(-1)
  const contentItems = Array.isArray(lastMessage?.content)
    ? lastMessage.content
    : []
  const textItems = contentItems.filter((
    item,
  ): item is Record<string, unknown> => {
    return isRecord(item) && item.type === 'output_text'
  })
  const reportText = textItems
    .map(item => String(item.text ?? ''))
    .join('\n\n')
  const sources = extractOpenAiSources(textItems)
  const toolCalls = output.filter((item) => {
    return isRecord(item) && item.type === 'web_search_call'
  }).length
  const usageRecord = isRecord(body.usage) ? body.usage : undefined

  return {
    reportText,
    sources,
    usage: {
      inputTokens: usageRecord
        ? toNumber(usageRecord.input_tokens)
        : undefined,
      outputTokens: usageRecord
        ? toNumber(usageRecord.output_tokens)
        : undefined,
      totalTokens: usageRecord
        ? toNumber(usageRecord.total_tokens)
        : undefined,
      toolCalls,
    },
  }
}

async function cancel(providerJobId: string, apiKey: string): Promise<void> {
  validateOpenAiJobId(providerJobId)

  const response = await fetch(
    `${OPENAI_RESPONSES_URL}/${providerJobId}/cancel`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
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

export const openAiResearchAdapter: ResearchAdapter = {
  start,
  status,
  result,
  cancel,
}
