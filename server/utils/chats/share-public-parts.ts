import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'

/**
 * The message parts a public share exposes: everything except tool parts.
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
      }),
    }
  })
}
