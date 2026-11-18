import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'
import { ARTIFACT_ATTACHMENT_PART_TYPE } from '#shared/utils/artifacts'
import { CONNECTOR_IMAGE_PART_TYPE } from '#shared/utils/connector-image-parts'
import { CONNECTORS_NOTICE_PART_TYPE } from '#shared/utils/connectors-parts'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  TOOL_GRANT_DATA_PART_TYPE,
  isToolApprovalPart,
} from '#shared/utils/tool-approval-parts'
import {
  SKILL_ACTIVATION_PART_TYPE,
  SKILL_INVOCATION_PART_TYPE,
} from '#shared/utils/skills/runtime'

/**
 * A user message that only attached a skill has no part left once the skill
 * parts are filtered out. The shared view and a visitor's branch skip it
 * instead of showing or copying an empty bubble.
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
    && part.type !== CONNECTORS_NOTICE_PART_TYPE
    && part.type !== CONNECTOR_IMAGE_PART_TYPE
    && part.type !== TOOL_APPROVAL_DATA_PART_TYPE
    && part.type !== TOOL_GRANT_DATA_PART_TYPE
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
 * a call that ran under a remembered approval. Connector call parts are
 * `dynamic-tool` parts, which `isToolUIPart` covers. A message that held
 * only a pending approval has nothing left to show and is left out.
 * The shared view and the share personal-data check both read through this,
 * so the check sees exactly what a visitor would.
 */
export function filterPublicParts<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages
    .map((message) => {
      return {
        message: {
          ...message,
          parts: message.parts.filter(isPublicPart),
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
