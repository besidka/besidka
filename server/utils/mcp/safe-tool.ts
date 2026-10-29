import { createError, log } from 'evlog'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const MCP_TOOL_FAILURE_MESSAGE
  = 'The tool could not complete the request. Try again later.'

type ToolHandler = (...args: never[]) => unknown

function readStatus(exception: unknown): number {
  if (!exception || typeof exception !== 'object') {
    return 0
  }

  const { status, statusCode } = exception as {
    status?: unknown
    statusCode?: unknown
  }

  if (typeof status === 'number') {
    return status
  }

  return typeof statusCode === 'number' ? statusCode : 0
}

export function isClientError(exception: unknown): boolean {
  const status = readStatus(exception)

  return status >= 400 && status < 500
}

function logToolFailure(exception: unknown): void {
  const failure = exception instanceof Error
    ? exception
    : new Error(String(exception))

  try {
    const logger = useRequestLogger(useEvent())

    logger.set({ action: 'mcp-tool-failure' })
    logger.error(failure)
  } catch {
    log.error({
      action: 'mcp-tool-failure',
      message: failure.message,
    })
  }
}

export function withSafeToolErrors<Handler extends ToolHandler>(
  handler: Handler,
): Handler {
  const safeHandler = async (...args: Parameters<Handler>) => {
    try {
      return await handler(...args)
    } catch (exception) {
      if (isClientError(exception)) {
        throw exception
      }

      logToolFailure(exception)

      throw createError({
        message: MCP_TOOL_FAILURE_MESSAGE,
        status: 500,
      })
    }
  }

  return safeHandler as unknown as Handler
}
