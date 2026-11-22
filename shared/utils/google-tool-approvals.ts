import { TOOL_APPROVAL_PAYLOAD_MAX_BYTES } from '#shared/utils/tool-approval-policy'

export const GOOGLE_TOOL_NAME_PREFIX = 'google__'

/**
 * The most a Google tool may return, measured as UTF-8 bytes of the
 * JSON-serialized output. A tool author caps the output here before
 * returning it: a paused turn keeps the body only in KV, and a body over
 * this size is not kept there, so the continuation sees only its
 * references (`stashGoogleToolResults`).
 */
export const GOOGLE_TOOL_OUTPUT_MAX_BYTES = TOOL_APPROVAL_PAYLOAD_MAX_BYTES

export const GOOGLE_EGRESS_GRANT_KEY_PREFIX = 'google-egress:'

/**
 * The static properties of the registered Google tools. A tool that is not
 * listed (an undescribed or unregistered `google__` name, any future tool
 * that does not say otherwise) returns Google content: its call taints the
 * send, its result flags the chat and its part counts as a Google result.
 * Only a tool whose result carries no Google content (a write that answers
 * with a link it just created) is listed with `returnsGoogleContent: false`.
 * Never inferred from a tool's kind or from the shape of its output.
 * `emptyListHoldsNoContent` marks the one listing tool whose answer, with no
 * references, names no file at all, so that answer does not flag the chat.
 */
export const GOOGLE_TOOL_PROPERTIES: Readonly<
  Record<string, {
    returnsGoogleContent: boolean
    emptyListHoldsNoContent?: boolean
  }>
> = {
  [`${GOOGLE_TOOL_NAME_PREFIX}drive_save_file`]: {
    returnsGoogleContent: false,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}drive_list_picked`]: {
    returnsGoogleContent: true,
    emptyListHoldsNoContent: true,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}drive_search`]: {
    returnsGoogleContent: true,
    emptyListHoldsNoContent: true,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}drive_read_found_file`]: {
    returnsGoogleContent: true,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}gmail_search`]: {
    returnsGoogleContent: true,
    emptyListHoldsNoContent: true,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}gmail_read_thread`]: {
    returnsGoogleContent: true,
  },
  [`${GOOGLE_TOOL_NAME_PREFIX}gmail_create_draft`]: {
    returnsGoogleContent: false,
  },
}

const GOOGLE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  `${GOOGLE_TOOL_NAME_PREFIX}drive_save_file`,
  `${GOOGLE_TOOL_NAME_PREFIX}gmail_create_draft`,
])

/**
 * Whether a Google tool writes to the user's Google account (a Drive save,
 * a Gmail draft). Its approval card never approves on Enter from the card
 * itself: the user must press the button.
 */
export function isGoogleWriteToolName(toolName: unknown): boolean {
  return typeof toolName === 'string'
    && GOOGLE_WRITE_TOOL_NAMES.has(toolName.toLowerCase())
}

/**
 * The option labels a Google tool shows instead of the generic ones, where
 * the generic label would understate what the answer covers.
 */
export const GOOGLE_TOOL_CHAT_GRANT_LABELS: Readonly<Record<string, string>>
  = {
    [`${GOOGLE_TOOL_NAME_PREFIX}drive_read_file`]: 'Allow reading any file '
      + 'you picked from Google Drive in this chat',
    [`${GOOGLE_TOOL_NAME_PREFIX}drive_list_picked`]: 'Allow listing the '
      + 'files you picked from Google Drive in this chat',
    [`${GOOGLE_TOOL_NAME_PREFIX}drive_search`]: 'Allow searching any file '
      + 'in your Google Drive in this chat',
    [`${GOOGLE_TOOL_NAME_PREFIX}gmail_search`]: 'Allow searching all your '
      + 'Gmail in this chat',
  }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A Google output as the model gets it back when stored parts are turned
 * into model messages again (an approval resume, a `{ continue }` round, the
 * stash that refills a paused turn): the references keep their id, kind and
 * date but never their title or link, because a title is a name someone
 * else wrote (a Drive file name, a calendar subject) and would reach the
 * model outside the untrusted frame that holds the same text. The stored
 * part keeps the title for the card. Idempotent.
 */
export function withoutReferenceNames(output: unknown): unknown {
  if (!isPlainRecord(output) || !Array.isArray(output.references)) {
    return output
  }

  return {
    ...output,
    references: output.references.map((reference) => {
      if (!isPlainRecord(reference)) {
        return reference
      }

      const { title: _title, link: _link, ...rest } = reference

      return rest
    }),
  }
}

export function googleToolReturnsContent(toolName: unknown): boolean {
  if (typeof toolName !== 'string') {
    return true
  }

  return Object.hasOwn(GOOGLE_TOOL_PROPERTIES, toolName)
    ? GOOGLE_TOOL_PROPERTIES[toolName]!.returnsGoogleContent
    : true
}

/**
 * Whether one finished result of a Google tool holds Google content, the
 * test that flags a chat: the tool returns content (`googleToolReturnsContent`)
 * and, for the listing tool only, names at least one file. An empty list
 * (nothing picked) or a list too long to show carries a count and a note,
 * and no file name, id or text from Google.
 */
export function googleToolResultHoldsContent(
  toolName: unknown,
  output: unknown,
): boolean {
  if (!googleToolReturnsContent(toolName)) {
    return false
  }

  const holdsNoContentWhenEmpty = typeof toolName === 'string'
    && Object.hasOwn(GOOGLE_TOOL_PROPERTIES, toolName)
    && GOOGLE_TOOL_PROPERTIES[toolName]!.emptyListHoldsNoContent === true

  if (!holdsNoContentWhenEmpty) {
    return true
  }

  return !isPlainRecord(output)
    || !Array.isArray(output.references)
    || output.references.length > 0
}

export const GOOGLE_TOOL_KINDS = ['read', 'write'] as const

export type GoogleToolKind = typeof GOOGLE_TOOL_KINDS[number]

export const GOOGLE_EGRESS_REASON_TEXT = 'Content from Google in this chat '
  + 'may be sent to this connector'

export const GOOGLE_EGRESS_GRANT_LABEL = 'May receive Google content in this '
  + 'chat'

export const GOOGLE_READ_GRANT_TITLE = 'Google'

/**
 * Whether a tool belongs to the Google family: its name starts with
 * `google__` in any letter case and names something after the prefix. A
 * name like `Google__Drive` is a Google tool too, so it asks like one and
 * can never fall back to the native write entry, which runs unasked.
 */
export function isGoogleToolName(toolName: unknown): toolName is string {
  return typeof toolName === 'string'
    && toolName.toLowerCase().startsWith(GOOGLE_TOOL_NAME_PREFIX)
    && toolName.length > GOOGLE_TOOL_NAME_PREFIX.length
}

/**
 * The key of a Google tool's "Allow in this chat" grant in
 * `besidka_chat_settings.alwaysAllowTools`: the exposed `google__` name, so
 * it can never collide with a Besidka (`besidka__`) or skill scripts key.
 */
export function googleChatGrantKey(toolName: string): string {
  return isGoogleToolName(toolName)
    ? toolName
    : `${GOOGLE_TOOL_NAME_PREFIX}${toolName}`
}

/**
 * The key of the Google egress grant of one connector tool in its
 * `connector_chat_settings.alwaysAllowTools`: it lets that tool run in a
 * chat that holds Google content, and nothing else.
 */
export function googleEgressGrantKey(exposedName: string): string {
  return `${GOOGLE_EGRESS_GRANT_KEY_PREFIX}${exposedName}`
}

/**
 * Whether a tool approval may offer Google tools in this send at all. The
 * approval family, the cleared-call guard and the references-only rules
 * only run while tool approvals are active, so without them a Google tool
 * must not be registered or offered.
 */
export function canOfferGoogleTools(input: {
  toolApprovalsActive: boolean
}): boolean {
  return input.toolApprovalsActive === true
}
