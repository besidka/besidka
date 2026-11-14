import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'
import { ARTIFACT_ATTACHMENT_PART_TYPE } from '#shared/utils/artifacts'
import {
  SKILL_ACTIVATION_PART_TYPE,
  SKILL_INVOCATION_PART_TYPE,
} from '#shared/utils/skills/runtime'

/**
 * The message parts a public share exposes: everything except tool parts,
 * artifact attachments (an artifact the owner attached from the library
 * is no part of what the chat shows, so sharing the chat never reveals it)
 * and the skill invocation and activation parts (a skill is the owner's
 * private text, so its name never reaches a shared chat).
 * The shared view and the share personal-data check both read through this,
 * so the check sees exactly what a visitor would.
 */
export function filterPublicParts<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.filter((part) => {
        return !isToolUIPart(part)
          && part.type !== ARTIFACT_ATTACHMENT_PART_TYPE
          && part.type !== SKILL_INVOCATION_PART_TYPE
          && part.type !== SKILL_ACTIVATION_PART_TYPE
      }),
    }
  })
}
