import type { UIMessage } from 'ai'
import { isOutputCardPart } from '~/utils/artifact-parts'
import { isCodeExecutionPart } from '~/utils/code-execution-ui'
import { isGeneratedImagePart } from '~/utils/generated-images'

/**
 * True when `part` renders as a block card in the message body: a generated
 * image, an artifact, a document or a code execution. Text, reasoning and the
 * parts that render nothing are not cards.
 */
export function isCardMessagePart(
  message: UIMessage,
  part: unknown,
): boolean {
  return isGeneratedImagePart(message, part)
    || isOutputCardPart(part)
    || isCodeExecutionPart(part)
}

function isTextMessagePart(part: unknown): boolean {
  return typeof part === 'object'
    && part !== null
    && (part as { type?: unknown }).type === 'text'
}

/**
 * True when `parts[index]` touches a part of the other kind: a text part
 * right after a card, or a card right after a text part. The page gives that
 * part `mt-4`, so text and cards never touch. Two cards, two texts and a
 * leading part are left alone.
 */
export function hasGapBeforePart(
  message: UIMessage,
  parts: UIMessage['parts'],
  index: number,
): boolean {
  const part = parts[index]
  const previous = parts[index - 1]

  if (!part || !previous) {
    return false
  }

  if (isTextMessagePart(part)) {
    return isCardMessagePart(message, previous)
  }

  return isTextMessagePart(previous) && isCardMessagePart(message, part)
}
