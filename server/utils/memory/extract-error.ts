export function memoryExtractionErrorSummary(exception: unknown): {
  errorName: string
  status?: number
} {
  if (!(exception instanceof Error)) {
    return { errorName: 'unknown' }
  }

  const { status, statusCode } = exception as {
    status?: unknown
    statusCode?: unknown
  }
  const httpStatus = [status, statusCode].find((value) => {
    return typeof value === 'number'
  }) as number | undefined

  return httpStatus === undefined
    ? { errorName: exception.name }
    : { errorName: exception.name, status: httpStatus }
}
