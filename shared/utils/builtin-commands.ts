import type { FeatureKey } from '#shared/utils/features/registry'

export const BUILTIN_COMMAND_PART_TYPE = 'data-command-invocation'
export const BUILTIN_COMMAND_ERROR_CODE = 'command_invocation_unavailable'

/**
 * Names Besidka keeps for built-in commands it may add later
 * (docs/skills.md, section 5.6; `usage` for a possible alias of `/stats`).
 * They are not offered anywhere yet, but a skill can never take one as its
 * command.
 */
export const PLANNED_BUILTIN_COMMAND_NAMES = [
  'new',
  'model',
  'search',
  'image',
  'memory',
  'project',
  'help',
  'usage',
] as const

export const BUILTIN_COMMAND_REPORT_PART_TYPE = 'data-command-report'

/**
 * A built-in command runs on Besidka's side with no model call: the server
 * runs the Besidka tool `besidkaTool` with the current chat and stores the
 * tool's `report` as the reply. It costs nothing and works with any model,
 * also one without a key. `argumentHint` is shown in the picker and on the
 * Skills page; `example` is a plain-words request that makes a model call
 * the same tool in a chat (that one does use the model).
 */
export interface BuiltinCommand {
  name: string
  title: string
  description: string
  argumentHint: string | null
  example: string
  requiredFeatures: readonly FeatureKey[]
  besidkaTool: string
}

export const BUILTIN_COMMANDS = [
  {
    name: 'cost',
    title: 'Chat cost',
    description: 'What this chat cost on your keys, by model',
    argumentHint: null,
    example: 'How much did this chat cost?',
    requiredFeatures: ['skills.commands'],
    besidkaTool: 'get_chat_cost',
  },
  {
    name: 'debug',
    title: 'Debug info',
    description: 'Ids, models and statuses of this chat, to send to support',
    argumentHint: null,
    example: 'Give me the debug info of this chat',
    requiredFeatures: ['skills.commands'],
    besidkaTool: 'get_debug_info',
  },
  {
    name: 'stats',
    title: 'Usage stats',
    description: 'Your models, tokens, cost and active days',
    argumentHint: '[7d|30d|all]',
    example: 'Show my usage stats for the last 30 days',
    requiredFeatures: ['skills.commands'],
    besidkaTool: 'get_usage_stats',
  },
] as const satisfies readonly BuiltinCommand[]

export type RegisteredBuiltinCommand = typeof BUILTIN_COMMANDS[number]

export type BuiltinCommandName = RegisteredBuiltinCommand['name']

export const BUILTIN_COMMAND_NAMES: readonly BuiltinCommandName[]
  = BUILTIN_COMMANDS.map(command => command.name)

export interface BuiltinCommandPartData {
  command: BuiltinCommandName
}

export interface DataBuiltinCommandPart {
  type: typeof BUILTIN_COMMAND_PART_TYPE
  data: BuiltinCommandPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isBuiltinCommandName(
  value: unknown,
): value is BuiltinCommandName {
  return typeof value === 'string'
    && (BUILTIN_COMMAND_NAMES as readonly string[]).includes(value)
}

export function getBuiltinCommand(
  name: BuiltinCommandName,
): RegisteredBuiltinCommand {
  return BUILTIN_COMMANDS.find(command => command.name === name)!
}

/**
 * Whether a user may run the command: every feature it needs is active.
 * `isFeatureActive` is the caller's view of the flags (the client payload,
 * or the server's evaluation for the request).
 */
/**
 * The built-ins whose name, title or description contains the search text,
 * the way the Skills page filters the user's own skills.
 */
export function filterBuiltinCommands<TCommand extends BuiltinCommand>(
  commands: readonly TCommand[],
  query: string,
): TCommand[] {
  const term = query.trim().toLowerCase().replace(/^\//, '')

  if (!term) {
    return [...commands]
  }

  return commands.filter((command) => {
    return command.name.includes(term)
      || command.title.toLowerCase().includes(term)
      || command.description.toLowerCase().includes(term)
  })
}

export function isBuiltinCommandAllowed(
  command: BuiltinCommand,
  isFeatureActive: (key: FeatureKey) => boolean,
): boolean {
  return command.requiredFeatures.every(isFeatureActive)
}

export function isDataBuiltinCommandPart(
  part: unknown,
): part is DataBuiltinCommandPart {
  return isRecord(part)
    && part.type === BUILTIN_COMMAND_PART_TYPE
    && isRecord(part.data)
    && isBuiltinCommandName(part.data.command)
}

export function findBuiltinCommandInvocation(
  parts: readonly unknown[] | undefined,
): BuiltinCommandPartData | null {
  const part = parts?.find(isDataBuiltinCommandPart)

  return part ? { command: part.data.command } : null
}

export function toBuiltinCommandPart(
  command: BuiltinCommandName,
): DataBuiltinCommandPart {
  return { type: BUILTIN_COMMAND_PART_TYPE, data: { command } }
}

export interface DataBuiltinCommandReportPart {
  type: typeof BUILTIN_COMMAND_REPORT_PART_TYPE
  data: BuiltinCommandPartData
}

export function toBuiltinCommandReportPart(
  command: BuiltinCommandName,
): DataBuiltinCommandReportPart {
  return { type: BUILTIN_COMMAND_REPORT_PART_TYPE, data: { command } }
}

export function isBuiltinCommandReportPart(
  part: unknown,
): part is DataBuiltinCommandReportPart {
  return isRecord(part)
    && part.type === BUILTIN_COMMAND_REPORT_PART_TYPE
    && isRecord(part.data)
    && isBuiltinCommandName(part.data.command)
}

/**
 * Whether a stored message belongs to a built-in command: the user message
 * that ran it or the report Besidka wrote back. Neither is ever sent to a
 * model, so a later turn never reads a report as the assistant's own words.
 */
export function isBuiltinCommandMessage(
  message: { parts?: unknown },
): boolean {
  const parts = Array.isArray(message.parts) ? message.parts : []

  return parts.some((part) => {
    return isDataBuiltinCommandPart(part) || isBuiltinCommandReportPart(part)
  })
}

const BACKTICK_RUN_PATTERN = /`+/g
const MIN_FENCE_LENGTH = 3

function buildReportFence(report: string): string {
  const longestRun = Math.max(
    0,
    ...(report.match(BACKTICK_RUN_PATTERN) ?? []).map(run => run.length),
  )

  return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1))
}

/**
 * The text of a command report as a stored reply: one fenced block, so it
 * renders preformatted and is copied as is. The fence is longer than any run
 * of backticks inside the report, so a model id or a title with backticks
 * can never close the block early.
 */
export function formatBuiltinCommandReply(report: string): string {
  const body = report.trimEnd()
  const fence = buildReportFence(body)

  return `${fence}text\n${body}\n${fence}`
}
