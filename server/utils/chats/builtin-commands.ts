import type { InferUIMessageChunk, UIMessage } from 'ai'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { RequestEvent } from 'nuxt/server'
import { and, eq, isNull, or } from 'drizzle-orm'
import { createError } from 'evlog'
import { ulid } from 'ulid'
import {
  BUILTIN_COMMAND_ERROR_CODE,
  findBuiltinCommandInvocation,
  formatBuiltinCommandReply,
  getBuiltinCommand,
  isBuiltinCommandReportPart,
  isDataBuiltinCommandPart,
  toBuiltinCommandReportPart,
} from '#shared/utils/builtin-commands'
import type {
  BuiltinCommandName,
  DataBuiltinCommandPart,
} from '#shared/utils/builtin-commands'
import type { FeatureKey } from '#shared/utils/features/registry'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { isDataSkillInvocationPart } from '#shared/utils/skills/runtime'
import * as schema from '~~/server/db/schema'
import { BESIDKA_TOOLS } from '~~/server/utils/besidka-tools/registry'
import type {
  BesidkaToolContext,
  BesidkaToolLogValue,
} from '~~/server/utils/besidka-tools/types'
import { enforceBuiltinCommandRateLimit } from '~~/server/utils/chats/builtin-command-rate-limit'
import { isChatGenerating } from '~~/server/utils/chats/generation-in-progress'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import {
  hasMeaningfulAssistantParts,
  persistUserMessage,
} from '~~/server/utils/chats/persist-user-message'
import type { PersistUserMessageInput } from '~~/server/utils/chats/persist-user-message'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { chatHasAwaitingApproval } from '~~/server/utils/tool-approval/send'
import {
  parseUsageStatsPeriod,
  USAGE_STATS_DEFAULT_PERIOD,
} from '~~/server/utils/usage/usage-stats'

type DbClient = ReturnType<typeof useDb>

export const BUILTIN_COMMAND_CLIENT_ID = 'besidka-command'

export const BUILTIN_COMMAND_APPROVAL_PENDING_CODE = 'approval_pending'

export const BUILTIN_COMMAND_FAILURE_TEXT = 'The command could not run. '
  + 'Try again in a moment.'

/**
 * The same 400 for every reason a built-in command cannot run (a feature it
 * needs is off, the message also attaches a skill or a file). The name of a
 * built-in is public, so the message can say which command it was.
 */
export function createBuiltinCommandUnavailableError(
  command: BuiltinCommandName,
) {
  return createError({
    message: `The /${command} command is not available`,
    status: 400,
    code: BUILTIN_COMMAND_ERROR_CODE,
    why: 'A feature this command needs is off for your account, or the '
      + 'message also attaches a skill or a file',
    fix: 'Send the command on its own',
  })
}

async function areFeaturesActive(
  event: Pick<RequestEvent, 'context'>,
  keys: readonly FeatureKey[],
  logger: LoggerLike,
): Promise<boolean> {
  try {
    for (const key of keys) {
      if (!(await evaluateFeatureForEvent(event, key)).active) {
        return false
      }
    }
  } catch (exception) {
    logger.set({
      attributes: {
        builtinCommand: { featureCheckError: exceptionMessage(exception) },
      },
    })

    return false
  }

  return true
}

/**
 * Validates the built-in command a user message runs
 * (`data-command-invocation`, docs/skills.md section 5.6) and rewrites the
 * part to its canonical shape. A message without one is returned as is and
 * costs nothing. The sender needs every feature the command lists, and the
 * message may hold only text next to it: a skill, a file or an artifact
 * would be dropped silently otherwise, since a command never reaches a
 * model. `onUnavailable: 'drop'` is for a message that is already stored:
 * the part is left out instead of failing the request.
 */
export async function resolveBuiltinCommandPart<
  TPart extends { type: string },
>(input: {
  event: Pick<RequestEvent, 'context'>
  parts: readonly TPart[]
  logger: LoggerLike
  onUnavailable?: 'throw' | 'drop'
}): Promise<TPart[]> {
  const invocations = input.parts.filter(
    (part): part is TPart & DataBuiltinCommandPart => {
      return isDataBuiltinCommandPart(part)
    },
  )
  const first = invocations[0]

  if (!first) {
    return [...input.parts]
  }

  const command = getBuiltinCommand(first.data.command)
  const hasOtherParts = input.parts.some((part) => {
    return part.type !== 'text'
      && !isDataBuiltinCommandPart(part)
      && !isDataSkillInvocationPart(part)
  })
  const hasSkill = input.parts.some(isDataSkillInvocationPart)
  const isAllowed = invocations.length === 1
    && !hasSkill
    && !hasOtherParts
    && await areFeaturesActive(
      input.event,
      command.requiredFeatures,
      input.logger,
    )

  if (!isAllowed) {
    if (input.onUnavailable === 'drop') {
      return input.parts.filter(part => !isDataBuiltinCommandPart(part))
    }

    throw createBuiltinCommandUnavailableError(first.data.command)
  }

  input.logger.set({
    attributes: { builtinCommand: { command: command.name } },
  })

  return input.parts.map((part) => {
    return isDataBuiltinCommandPart(part)
      ? {
        type: part.type,
        data: { command: part.data.command },
      } as unknown as TPart
      : part
  })
}

function readArgumentsText(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      const record = part as { type?: unknown, text?: unknown }

      return record.type === 'text' && typeof record.text === 'string'
        ? record.text
        : ''
    })
    .join(' ')
    .trim()
}

function readStatus(exception: unknown): number {
  const record = exception as { status?: unknown, statusCode?: unknown }
  const status = record?.status ?? record?.statusCode

  return typeof status === 'number' ? status : 500
}

export interface BuiltinCommandRun {
  report: string
  outcome: 'ok' | 'error' | 'unavailable'
  status?: number
}

/**
 * Runs a built-in command without any model: the Besidka tool it names is
 * called directly as the signed-in user, for the current chat, and its
 * `report` is the reply. The arguments are the text the user typed after
 * the command (`/stats 7d`); a command that takes none ignores the text,
 * which stays in the chat as the user's note. A client error of the tool
 * (4xx) is shown with its own message; anything else is one fixed sentence.
 */
export async function runBuiltinCommand(input: {
  db: DbClient
  userId: number
  chatSlug: string
  command: BuiltinCommandName
  argumentsText: string
  logger: LoggerLike
}): Promise<BuiltinCommandRun> {
  const command = getBuiltinCommand(input.command)
  const besidkaTool = Object.hasOwn(BESIDKA_TOOLS, command.besidkaTool)
    ? BESIDKA_TOOLS[command.besidkaTool as keyof typeof BESIDKA_TOOLS]
    : null

  if (!besidkaTool) {
    return {
      report: `/${command.name} is not available yet.`,
      outcome: 'unavailable',
      status: 501,
    }
  }

  const toolInput: Record<string, unknown> = {}
  let note: string | null = null

  if (command.name === 'stats') {
    const period = parseUsageStatsPeriod(input.argumentsText.split(/\s+/)[0])

    toolInput.period = period ?? USAGE_STATS_DEFAULT_PERIOD
    note = period
      ? null
      : `Unknown period, showing ${
        USAGE_STATS_DEFAULT_PERIOD
      }. Use 7d, 30d or all.`
  }

  const context: BesidkaToolContext = {
    userId: input.userId,
    clientId: BUILTIN_COMMAND_CLIENT_ID,
    scopes: [],
    currentChatSlug: input.chatSlug,
    db: input.db,
    logger: input.logger,
    log: (fields: Record<string, BesidkaToolLogValue>) => {
      input.logger.set({
        attributes: { builtinCommand: { tool: besidkaTool.name, ...fields } },
      })
    },
  }

  try {
    const result = await besidkaTool.handler(toolInput as never, context)
    const report = (result as { report?: unknown })?.report

    return {
      report: [note, typeof report === 'string' ? report : '']
        .filter(Boolean)
        .join('\n\n'),
      outcome: 'ok',
    }
  } catch (exception) {
    const status = readStatus(exception)

    input.logger.set({
      attributes: {
        builtinCommand: {
          outcome: 'error',
          status,
          error: exceptionMessage(exception),
        },
      },
    })

    const isClientError = status >= 400 && status < 500

    return {
      report: isClientError && exception instanceof Error
        ? exception.message || BUILTIN_COMMAND_FAILURE_TEXT
        : BUILTIN_COMMAND_FAILURE_TEXT,
      outcome: 'error',
      status: isClientError ? status : 500,
    }
  }
}

function toReplyChunks(
  messageId: string,
  parts: UIMessage['parts'],
  createdAt: string,
): InferUIMessageChunk<UIMessage>[] {
  const chunks: InferUIMessageChunk<UIMessage>[] = [
    { type: 'start', messageId },
  ]

  for (const [index, part] of parts.entries()) {
    if (isBuiltinCommandReportPart(part)) {
      chunks.push(part as InferUIMessageChunk<UIMessage>)

      continue
    }

    if (part.type === 'text') {
      const id = `command-text-${index}`

      chunks.push(
        { type: 'text-start', id },
        { type: 'text-delta', id, delta: part.text },
        { type: 'text-end', id },
      )
    }
  }

  chunks.push({ type: 'finish', messageMetadata: { createdAt } })

  return chunks
}

function streamReply(
  messageId: string,
  parts: UIMessage['parts'],
  createdAt: string,
): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute({ writer }) {
        for (const chunk of toReplyChunks(messageId, parts, createdAt)) {
          writer.write(chunk)
        }
      },
    }),
  })
}

type StoredMessage = PersistUserMessageInput['chat']['messages'][number]
  & { createdAt?: Date | null }

/**
 * The stored messages the way the chat route hands them to
 * `persistUserMessage`: persisted roles only, empty assistant rows left out,
 * keyed by public id.
 */
function toPreviousMessages(
  messages: readonly StoredMessage[],
): PersistUserMessageInput['previousMessages'] {
  return messages
    .filter((message) => {
      return isPersistedMessageRole(message.role)
        && (
          message.role !== 'assistant'
          || hasMeaningfulAssistantParts(message.parts)
        )
    })
    .map((message) => {
      return {
        id: message.publicId ?? message.id,
        role: message.role,
        parts: message.parts,
        tools: message.tools,
        reasoning: message.reasoning,
      }
    })
}

function findStoredReply(
  messages: readonly StoredMessage[],
  userMessageId: string,
): StoredMessage | null {
  const userIndex = messages.findIndex((message) => {
    return message.role === 'user'
      && (message.publicId ?? message.id) === userMessageId
  })

  if (userIndex < 0) {
    return null
  }

  const next = messages[userIndex + 1]

  return next?.role === 'assistant'
    && next.parts.some(isBuiltinCommandReportPart)
    ? next
    : null
}

/**
 * The whole send of a message that runs a built-in command (`/cost`,
 * `/stats`, `/debug`), answered before any model, key or provider is
 * resolved, so it spends nothing and works with any model. It stores the
 * user message, runs the command (`runBuiltinCommand`), stores the report as
 * an assistant message (a `data-command-report` marker and one code-block
 * text part, no usage) and streams that message back like a normal reply,
 * so the chat pins and finishes it the usual way. A resend of the same user
 * message replays the stored report. While a reply is still being written in
 * the chat it answers 409: storing a command in the middle of a generation
 * would put the two replies out of order. It answers 409 as well while a
 * tool approval of the chat waits for an answer (a command is not a message
 * that dismisses it), and 429 past 30 commands a minute. A run that fails
 * stores no reply and answers with the error, so only a report is ever
 * replayed; the user message stays, and a resend runs the command again.
 */
export async function respondWithBuiltinCommand(input: {
  event: RequestEvent
  db: DbClient
  userId: number
  chat: PersistUserMessageInput['chat'] & {
    slug: string
    messages: StoredMessage[]
  }
  newMessage: { id: string, parts: UIMessage['parts'] }
  logger: LoggerLike
}): Promise<Response> {
  const { db, chat, newMessage, logger } = input
  const invocation = findBuiltinCommandInvocation(newMessage.parts)

  if (!invocation) {
    throw createError({ message: 'No command in the message', status: 400 })
  }

  const storedReply = findStoredReply(chat.messages, newMessage.id)

  if (storedReply) {
    logger.set({ attributes: { builtinCommand: { replayed: true } } })

    return streamReply(
      storedReply.publicId ?? storedReply.id,
      storedReply.parts,
      (storedReply.createdAt ?? new Date()).toISOString(),
    )
  }

  await enforceBuiltinCommandRateLimit(input.userId, input.event)

  if (await isChatGenerating(chat.id)) {
    throw createError({
      message: 'A reply is still being written in this chat',
      status: 409,
      code: 'generation_in_progress',
      why: 'A command waits until the reply in progress is stored',
      fix: 'Wait for the reply or stop it, then run the command again',
    })
  }

  if (chatHasAwaitingApproval(chat.messages)) {
    throw createError({
      message: 'Answer or dismiss the pending approval first.',
      status: 409,
      code: BUILTIN_COMMAND_APPROVAL_PENDING_CODE,
      why: 'A command would leave the approval card in this chat '
        + 'without an answer',
      fix: 'Approve or deny the tool call, or send a normal message to '
        + 'dismiss it, then run the command again',
    })
  }

  await persistUserMessage({
    db,
    event: input.event,
    logger,
    userId: input.userId,
    chat: {
      id: chat.id,
      projectId: chat.projectId,
      messages: chat.messages,
    },
    previousMessages: toPreviousMessages(chat.messages),
    newMessage,
    tools: [],
    reasoning: 'off',
  })

  const startedAt = Date.now()
  const result = await runBuiltinCommand({
    db,
    userId: input.userId,
    chatSlug: chat.slug,
    command: invocation.command,
    argumentsText: readArgumentsText(newMessage.parts),
    logger,
  })

  if (result.outcome !== 'ok') {
    logger.set({
      attributes: {
        builtinCommand: {
          command: invocation.command,
          outcome: result.outcome,
          durationMs: Date.now() - startedAt,
        },
      },
    })

    throw createError({
      message: result.report,
      status: result.status ?? 500,
      code: 'command_failed',
      why: 'The command did not produce a report, so nothing was stored '
        + 'as its reply',
      fix: 'Run the command again',
    })
  }

  const parts = [
    toBuiltinCommandReportPart(invocation.command),
    { type: 'text', text: formatBuiltinCommandReply(result.report) },
  ] as unknown as UIMessage['parts']
  const messageId = ulid()
  const createdAt = new Date()

  await insertMessageWithPublicId({
    db,
    values: {
      chatId: chat.id,
      role: 'assistant',
      parts,
      tools: [],
      reasoning: 'off',
      createdAt,
    },
    publicId: messageId,
  })
  await db.update(schema.chats)
    .set({ activityAt: createdAt })
    .where(eq(schema.chats.id, chat.id))

  if (!chat.messages.some(message => message.role === 'user')) {
    await db.update(schema.chats)
      .set({ title: getBuiltinCommand(invocation.command).title })
      .where(and(
        eq(schema.chats.id, chat.id),
        or(eq(schema.chats.title, ''), isNull(schema.chats.title)),
      ))
  }

  logger.set({
    attributes: {
      builtinCommand: {
        command: invocation.command,
        outcome: result.outcome,
        durationMs: Date.now() - startedAt,
      },
    },
  })

  return streamReply(messageId, parts, createdAt.toISOString())
}
