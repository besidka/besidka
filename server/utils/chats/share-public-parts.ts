import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'
import { ARTIFACT_ATTACHMENT_PART_TYPE } from '#shared/utils/artifacts'
import {
  BUILTIN_COMMAND_PART_TYPE,
  isBuiltinCommandMessage,
} from '#shared/utils/builtin-commands'
import { DRIVE_FILE_PART_TYPE } from '#shared/utils/google-drive'
import { CONNECTOR_IMAGE_PART_TYPE } from '#shared/utils/connector-image-parts'
import { CONNECTORS_NOTICE_PART_TYPE } from '#shared/utils/connectors-parts'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  TOOL_GRANT_DATA_PART_TYPE,
  isToolApprovalPart,
} from '#shared/utils/tool-approval-parts'
import { TOOL_BUDGET_PART_TYPE } from '#shared/utils/tool-rounds'
import { REPLY_STOPPED_PART_TYPE } from '#shared/utils/chat-reply-stopped'
import { GOOGLE_TOOLS_WITHHELD_PART_TYPE } from '#shared/utils/google-tools-withheld'
import {
  SKILL_ACTIVATION_PART_TYPE,
  SKILL_INVOCATION_PART_TYPE,
} from '#shared/utils/skills/runtime'

/**
 * A user message that only attached a skill or ran a built-in command has no
 * part left once those parts are filtered out. The shared view and a
 * visitor's branch skip it instead of showing or copying an empty bubble.
 */
export function dropEmptyUserMessages<
  TMessage extends { role: string, parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages.filter((message) => {
    return message.role !== 'user' || message.parts.length > 0
  })
}

function isPublicPart(part: UIMessage['parts'][number]): boolean {
  return !isToolUIPart(part)
    && part.type !== ARTIFACT_ATTACHMENT_PART_TYPE
    && part.type !== SKILL_INVOCATION_PART_TYPE
    && part.type !== SKILL_ACTIVATION_PART_TYPE
    && part.type !== BUILTIN_COMMAND_PART_TYPE
    && part.type !== CONNECTORS_NOTICE_PART_TYPE
    && part.type !== CONNECTOR_IMAGE_PART_TYPE
    && part.type !== TOOL_APPROVAL_DATA_PART_TYPE
    && part.type !== TOOL_GRANT_DATA_PART_TYPE
    && part.type !== TOOL_BUDGET_PART_TYPE
    && part.type !== REPLY_STOPPED_PART_TYPE
    && part.type !== GOOGLE_TOOLS_WITHHELD_PART_TYPE
}

/**
 * A Google Drive reference in a public share carries only the file name:
 * no Drive id, no link and no media type, so a visitor learns nothing that
 * opens or identifies the file at Google. The copy itself is never granted
 * to a share (`docs/google.md`, section 5.3).
 */
function toPublicPart(
  part: UIMessage['parts'][number],
): UIMessage['parts'][number] {
  if (part.type !== DRIVE_FILE_PART_TYPE) {
    return part
  }

  const name = (part as { data?: { name?: unknown } }).data?.name

  return {
    type: DRIVE_FILE_PART_TYPE,
    data: {
      driveFileId: '',
      name: typeof name === 'string' ? name : '',
      mimeType: '',
      link: '',
    },
  } as unknown as UIMessage['parts'][number]
}

/**
 * The message parts a public share exposes: everything except tool parts,
 * artifact attachments (an artifact the owner attached from the library
 * is no part of what the chat shows, so sharing the chat never reveals it)
 * the skill invocation and activation parts (a skill is the owner's
 * private text, so its name never reaches a shared chat), the connector
 * notice (it names the owner's connectors), the `data-connector-image`
 * parts (a connector's images stay owner-only, and only `file` parts give a
 * share a file grant), the `data-tool-approval`
 * part of a call that waits for approval and the `data-tool-grant` part of
 * a call that ran under a remembered approval, and the
 * `data-reply-stopped` marker of a reply the owner stopped, and the
 * `data-google-tools-withheld` note (a hint for the owner only). Connector call
 * parts are `dynamic-tool` parts, which `isToolUIPart` covers. A message
 * that held only a pending approval has nothing left to show and is left
 * out. The messages of a built-in command (`/cost`, `/stats`, `/debug` and
 * the report Besidka wrote back) are left out whole: a report describes the
 * owner's account (spend, models, ids), which a share never shows.
 * The shared view and the share personal-data check both read through this,
 * so the check sees exactly what a visitor would.
 */
export function filterPublicParts<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages
    .filter(message => !isBuiltinCommandMessage(message))
    .map((message) => {
      return {
        message: {
          ...message,
          parts: message.parts.filter(isPublicPart).map(toPublicPart),
        },
        hadApprovalPart: message.parts.some(isToolApprovalPart),
      }
    })
    .filter(({ message, hadApprovalPart }) => {
      return !hadApprovalPart
        || message.parts.some(part => part.type !== 'step-start')
    })
    .map(({ message }) => message)
}
