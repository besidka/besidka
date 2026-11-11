import {
  DOCUMENT_CHAT_CONTEXT_LIMIT,
  DOCUMENT_FEATURE_KEYS,
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_LABELS,
} from '#shared/utils/documents'
import type { DocumentFormat } from '#shared/utils/documents'
import { defineCapability } from '~~/server/capabilities/types'
import type { CapabilityToolContext } from '~~/server/capabilities/types'
import { createDocumentTool } from '~~/server/utils/documents/create-document-tool'
import { listChatDocuments } from '~~/server/utils/documents/store'

type DbClient = ReturnType<typeof useDb>

const CONTEXT_TITLE_MAX_CHARACTERS = 80

function toSingleLineTitle(title: string | null): string {
  const singleLine = [...(title ?? '')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0

      return codePoint < 0x20 || codePoint === 0x7f ? ' ' : character
    })
    .join('')
    .replace(/["\\]+/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  if (!singleLine) {
    return 'Untitled'
  }

  const characters = [...singleLine]

  return characters.length > CONTEXT_TITLE_MAX_CHARACTERS
    ? `${characters.slice(0, CONTEXT_TITLE_MAX_CHARACTERS - 1).join('')}…`
    : singleLine
}

export function getEnabledDocumentFormats(
  isFeatureActive: CapabilityToolContext['isFeatureActive'],
): DocumentFormat[] {
  return DOCUMENT_FORMATS.filter((format) => {
    return isFeatureActive(DOCUMENT_FEATURE_KEYS[format])
  })
}

/**
 * One system line that tells the model which documents this chat already
 * holds, so a follow-up such as "make it shorter" refers to the right one
 * and a new `create_document` call is an explicit choice. Titles are text a
 * model wrote, so each is reduced to one short line. Returns an empty string
 * when the chat has no documents.
 */
export async function buildDocumentsContextLine(
  db: DbClient,
  input: { userId: number, chatId: string },
): Promise<string> {
  const documents = await listChatDocuments(db, {
    userId: input.userId,
    chatId: input.chatId,
    limit: DOCUMENT_CHAT_CONTEXT_LIMIT,
  })

  if (documents.length === 0) {
    return ''
  }

  const entries = documents.map((document) => {
    const label = DOCUMENT_FORMAT_LABELS[document.format]

    return `"${toSingleLineTitle(document.title)}" (${label}, id ${document.id})`
  })

  return 'Documents already created in this chat, newest first: '
    + `${entries.join('; ')}. They cannot be edited in place; create a `
    + 'new document only when the user asks for one.'
}

export const documentsCapability = defineCapability({
  feature: 'documents',
  routesPrefix: ['documents'],
  aiTools(context) {
    if (!context.assistantMessageId) {
      return {}
    }

    if (context.model && context.model.toolCall === false) {
      return {}
    }

    const enabledFormats = getEnabledDocumentFormats(context.isFeatureActive)

    if (enabledFormats.length === 0) {
      return {}
    }

    return createDocumentTool({
      userId: context.userId,
      chatId: context.chatId,
      db: context.db,
      logger: context.logger,
      enabledFormats,
      modelId: context.modelId ?? context.model?.id ?? null,
      assistantMessageId: context.assistantMessageId,
    })
  },
})
