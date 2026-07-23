export function exceptionMessage(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception)
}
