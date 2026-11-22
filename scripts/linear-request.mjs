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

const GENERIC_EXTENSION_KEYS = new Set([
  'code',
  'type',
  'userError',
  'statusCode',
  'userPresentableMessage',
])

/**
 * Formats GraphQL errors with the details Linear puts in `extensions`, such
 * as `userPresentableMessage` and validation details, because the top-level
 * `message` of a validation failure is only "Argument Validation Error".
 */
export function formatGraphqlErrors(errors) {
  return errors.map((error) => {
    const extensions = error.extensions ?? {}
    const parts = [error.message]
    const presentable = extensions.userPresentableMessage

    if (presentable && presentable !== error.message) {
      parts.push(presentable)
    }

    const details = Object.fromEntries(
      Object.entries(extensions).filter(([key]) => {
        return !GENERIC_EXTENSION_KEYS.has(key)
      }),
    )

    if (Object.keys(details).length) {
      parts.push(JSON.stringify(details))
    }

    return parts.filter(Boolean).join(': ')
  }).join('; ')
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

    const message = body.errors?.length
      ? formatGraphqlErrors(body.errors)
      : ''

    throw new Error(message || `HTTP ${response.status}`)
  }
}
