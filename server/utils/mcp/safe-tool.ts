import { createError, log } from 'evlog'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
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

function logToolErrorStatus(status: number): void {
  try {
    useRequestLogger(useEvent()).set({ mcp: { error_status: status } })
  } catch {
    return
  }
}

function logToolFailure(exception: unknown, toolName: string): void {
  const details: Record<string, string> = {
    toolName,
    ...exceptionSummary(exception),
  }
  const sanitizedFailure = new Error(`The MCP tool ${toolName} failed`)

  sanitizedFailure.name = details.errorName ?? 'Error'

  try {
    const logger = useRequestLogger(useEvent())

    logger.set({
      action: 'mcp-tool-failure',
      attributes: { mcpToolFailure: details },
    })
    logger.error(sanitizedFailure)
  } catch {
    log.error({
      action: 'mcp-tool-failure',
      attributes: { mcpToolFailure: details },
    })
  }
}

export function withSafeToolErrors<Handler extends ToolHandler>(
  handler: Handler,
  toolName: string,
): Handler {
  const safeHandler = async (...args: Parameters<Handler>) => {
    try {
      return await handler(...args)
    } catch (exception) {
      if (isClientError(exception)) {
        logToolErrorStatus(readStatus(exception))

        throw exception
      }

      logToolErrorStatus(500)
      logToolFailure(exception, toolName)

      throw createError({
        message: MCP_TOOL_FAILURE_MESSAGE,
        status: 500,
      })
    }
  }

  return safeHandler as unknown as Handler
}
