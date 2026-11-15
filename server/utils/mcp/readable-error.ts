import { createError } from 'evlog'
import { isClientError } from '~~/server/utils/mcp/safe-tool'

function toSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * The store's errors carry the useful part in `why` and `fix`, which an MCP
 * client never shows because it only prints `message`. Folds them into the
 * message, like the in-chat artifact tools do.
 */
export function withReadableDetails(exception: unknown): unknown {
  if (!isClientError(exception)) {
    return exception
  }

  const error = exception as {
    message: string
    status: number
    code?: string
    why?: string
    fix?: string
  }
  const hasWhy = Boolean(error.why) && error.why !== error.message
  const hasFix = Boolean(error.fix)

  if (!hasWhy && !hasFix) {
    return exception
  }

  const parts = [
    toSentence(error.message),
    hasWhy ? toSentence(error.why!) : '',
    hasFix ? toSentence(error.fix!) : '',
  ].filter(Boolean)

  return createError({
    message: parts.join(' '),
    status: error.status,
    code: error.code,
  })
}

export async function readable<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation()
  } catch (exception) {
    throw withReadableDetails(exception)
  }
}
