type FetchFunction = typeof globalThis.fetch

const XAI_RESPONSES_PATH_SUFFIX = '/responses'
const XAI_REASONING_SUMMARY = 'detailed'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveRequestPathname(input: RequestInfo | URL): string | null {
  const url = input instanceof Request ? input.url : String(input)

  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

function isXaiResponsesRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): init is RequestInit & { body: string } {
  return init?.method === 'POST'
    && typeof init.body === 'string'
    && !!resolveRequestPathname(input)?.endsWith(XAI_RESPONSES_PATH_SUFFIX)
}

export function addXaiReasoningSummary(body: string): string {
  let payload: unknown

  try {
    payload = JSON.parse(body)
  } catch {
    return body
  }

  if (!isPlainObject(payload)) {
    return body
  }

  const reasoning = isPlainObject(payload.reasoning) ? payload.reasoning : {}

  return JSON.stringify({
    ...payload,
    reasoning: {
      ...reasoning,
      summary: reasoning.summary ?? XAI_REASONING_SUMMARY,
    },
  })
}

/**
 * Wraps fetch so every xAI Responses API request asks for a reasoning
 * summary. `@ai-sdk/xai` 5 deprecated `reasoningSummary` and stopped sending
 * `reasoning.summary` (vercel/ai#21410), but xAI only streams reasoning
 * summary items when the request carries a `reasoning` object, so without
 * this the reasoning trace never renders. See `docs/providers/xai.md`.
 */
export function withXaiReasoningSummary(
  baseFetch: FetchFunction = (input, init) => fetch(input, init),
): FetchFunction {
  return async (input, init) => {
    if (!isXaiResponsesRequest(input, init)) {
      return await baseFetch(input, init)
    }

    return await baseFetch(input, {
      ...init,
      body: addXaiReasoningSummary(init.body),
    })
  }
}
