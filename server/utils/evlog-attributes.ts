export function exceptionMessage(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception)
}

export function exceptionStack(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined
}
