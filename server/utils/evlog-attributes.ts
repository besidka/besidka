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
