export const MAX_ATTEMPTS = 4
export const RATE_LIMIT_STEP_MS = 15_000
export const SERVER_ERROR_BACKOFF_MS = [2_000, 5_000, 10_000]

const SERVER_ERROR_PATTERN = /internal.?(server.?)?error/i

function hasGraphqlError(body, predicate) {
  return Boolean(body.errors?.some(predicate))
}

export function isRateLimited(response, body) {
  return response.status === 429
    || hasGraphqlError(body, (error) => {
      return error.extensions?.code === 'RATELIMITED'
    })
}

export function isTransientServerError(response, body) {
  return response.status >= 500
    || hasGraphqlError(body, (error) => {
      return SERVER_ERROR_PATTERN.test(error.extensions?.code ?? '')
        || SERVER_ERROR_PATTERN.test(error.extensions?.type ?? '')
        || SERVER_ERROR_PATTERN.test(error.message ?? '')
    })
}

export function getRetryDelay(response, body, attempt) {
  if (isRateLimited(response, body)) {
    return attempt * RATE_LIMIT_STEP_MS
  }

  if (isTransientServerError(response, body)) {
    return SERVER_ERROR_BACKOFF_MS[attempt - 1]
  }

  return null
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function linearRequest({
  apiUrl,
  apiKey,
  query,
  variables,
  sleep = wait,
}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })
    const body = await response.json().catch(() => ({}))

    if (response.ok && !body.errors?.length) {
      return body.data
    }

    const retryDelay = getRetryDelay(response, body, attempt)

    if (retryDelay !== null && attempt < MAX_ATTEMPTS) {
      await sleep(retryDelay)

      continue
    }

    const message = body.errors?.map(error => error.message).join('; ')

    throw new Error(message || `HTTP ${response.status}`)
  }
}
