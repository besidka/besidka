import type { ToolSet } from 'ai'
import {
  googleToolResultHoldsContent,
  googleToolReturnsContent,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { markChatGoogleData } from '~~/server/utils/tool-approval/google'

type DbClient = ReturnType<typeof useDb>

/**
 * The once-per-send write of `chats.google_data_at` for a chat that did not
 * hold Google data when the send began. It is awaited and fails closed: a
 * failed write throws, so the call that would bring Google data in, or
 * write a marked item, does not go on. A chat that is already flagged costs
 * nothing, and parallel callers share one write; a failed write is retried
 * by the next caller.
 */
export function createGoogleDataFlagger(input: {
  db: DbClient
  chatPublicId: string
  isAlreadyFlagged: () => boolean
  logger: LoggerLike
}): () => Promise<void> {
  let isFlagged = false
  let inFlight: Promise<void> | null = null

  return async function ensureFlagged() {
    if (isFlagged || input.isAlreadyFlagged()) {
      return
    }

    inFlight ??= markChatGoogleData(
      input.db,
      input.chatPublicId,
      input.logger,
      { failClosed: true },
    ).then(() => {
      isFlagged = true
    }).finally(() => {
      inFlight = null
    })

    await inFlight
  }
}

function isFunctionTool(tool: unknown): tool is {
  execute: (toolInput: unknown, options?: unknown) => unknown
} {
  if (typeof tool !== 'object' || tool === null) {
    return false
  }

  const record = tool as Record<string, unknown>

  return record.type !== 'provider' && typeof record.execute === 'function'
}

function isAsyncGeneratorFunction(execute: unknown): boolean {
  return typeof execute === 'function'
    && execute.constructor.name === 'AsyncGeneratorFunction'
}

/**
 * Makes every function tool of a send flag the chat before Google data can
 * outlive the send. A Google tool flags after its result exists; any other
 * tool flags before it runs when the send is already Google-derived (so a
 * marked write never lands in an unflagged chat), and every tool flags again
 * once it returned if taint appeared while it ran. If the flag write fails
 * the call fails and its result is dropped.
 */
export function withGoogleDataFlag(
  tools: ToolSet | undefined,
  input: {
    isGoogleDerived: () => boolean
    ensureFlagged: () => Promise<void>
  },
): ToolSet | undefined {
  if (!tools) {
    return tools
  }

  return Object.fromEntries(Object.entries(tools).map(([toolName, tool]) => {
    if (!isFunctionTool(tool)) {
      return [toolName, tool]
    }

    const execute = tool.execute.bind(tool)
    const isGoogleTool = isGoogleToolName(toolName)
      && googleToolReturnsContent(toolName)

    if (isAsyncGeneratorFunction(tool.execute)) {
      return [toolName, {
        ...tool,
        execute: async function* (toolInput: unknown, options?: unknown) {
          if (!isGoogleTool && input.isGoogleDerived()) {
            await input.ensureFlagged()
          }

          yield* execute(toolInput, options) as AsyncIterable<unknown>

          if (input.isGoogleDerived()) {
            await input.ensureFlagged()
          }
        },
      } as ToolSet[string]]
    }

    return [toolName, {
      ...tool,
      execute: async (toolInput: unknown, options?: unknown) => {
        if (!isGoogleTool && input.isGoogleDerived()) {
          await input.ensureFlagged()
        }

        const result = await execute(toolInput, options)
        const returnedNothingFromGoogle = isGoogleTool
          && !googleToolResultHoldsContent(toolName, result)

        if (!returnedNothingFromGoogle && input.isGoogleDerived()) {
          await input.ensureFlagged()
        }

        return result
      },
    } as ToolSet[string]]
  }))
}
