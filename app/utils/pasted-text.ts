export interface PastedText {
  id: string
  content: string
}

export const MAX_PASTED_TEXTS = 10
export const PASTED_TEXT_NAME = 'Pasted text'
export const PASTED_TEXT_MEDIA_TYPE = 'text/plain'

export function createPastedText(content: string): PastedText {
  return {
    id: `pasted-${crypto.randomUUID()}`,
    content,
  }
}

export function getPastedTextSize(content: string): number {
  return new Blob([content]).size
}

/**
 * The pasted blocks are only a display aid in the chat input: on send they
 * are appended to the typed text as plain text, so the request, D1 and the
 * model see one ordinary text message.
 */
export function joinMessageWithPastedTexts(
  message: string,
  pastedTexts: Pick<PastedText, 'content'>[],
): string {
  const pastedBlocks = pastedTexts
    .map(pastedText => pastedText.content.trim() ? pastedText.content : '')
    .filter(Boolean)

  if (!pastedBlocks.length) {
    return message
  }

  const typedText = message.trim() ? message.trimEnd() : ''

  return [typedText, ...pastedBlocks].filter(Boolean).join('\n\n')
}
