const BOUND_PARAMETERS_MARKER = '\nparams:'

function withoutBoundParameters(message: string): string {
  const markerIndex = message.indexOf(BOUND_PARAMETERS_MARKER)

  return markerIndex === -1 ? message : message.slice(0, markerIndex)
}

/**
 * Message of a caught value for log attributes. Drizzle query errors append
 * the bound parameters (user strings such as titles and paths) to the
 * message after a `\nparams:` line, so the text is cut there and no bound
 * parameter reaches the logs. The `cause` is never included.
 */
export function exceptionMessage(exception: unknown): string {
  const message = exception instanceof Error
    ? exception.message
    : String(exception)

  return withoutBoundParameters(message)
}

function readStringProperty(source: unknown, property: string): string | null {
  if (!source || typeof source !== 'object') {
    return null
  }

  const value = (source as Record<string, unknown>)[property]

  return typeof value === 'string' ? value : null
}

function readErrorName(exception: unknown): string {
  return exception instanceof Error ? exception.name : typeof exception
}

/**
 * Message-free description of a caught value for log attributes that must
 * not carry user text: the error name and the code and name of its cause.
 * Neither the message, the bound parameters nor the stack is included.
 */
export function exceptionSummary(exception: unknown): Record<string, string> {
  const cause = exception instanceof Error ? exception.cause : null
  const details: Record<string, string | null> = {
    errorName: readErrorName(exception),
    errorCode: readStringProperty(exception, 'code'),
    causeName: cause ? readErrorName(cause) : null,
    causeCode: readStringProperty(cause, 'code'),
  }

  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string] => {
      return entry[1] !== null
    }),
  )
}
