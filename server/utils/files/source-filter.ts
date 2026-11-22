import { and, eq, inArray, like, ne } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { DOCUMENT_MEDIA_TYPES } from '#shared/utils/documents'
import {
  isFileLinkedToKnowledgeSql,
  isFileNotLinkedToKnowledgeSql,
} from '~~/server/utils/knowledge/linked-files'

export const filesSourceFilters = [
  'all',
  'upload',
  'assistant',
  'project',
  'library',
] as const

export type FilesSourceFilter = typeof filesSourceFilters[number]

/**
 * Images connectors returned in chats (`source = 'connector'`) belong to
 * their chat: no file list shows them, for every source. They still count
 * toward storage and are deleted from the Storage page or with their chat.
 */
const isListedFile = ne(schema.files.source, 'connector')

function getSourceOnlyCondition(source: FilesSourceFilter) {
  const isNotLinked = isFileNotLinkedToKnowledgeSql(schema.files.id)

  switch (source) {
    case 'project':
      return isFileLinkedToKnowledgeSql(schema.files.id)
    case 'library':
      return eq(schema.files.source, 'upload')
    case 'upload':
    case 'assistant':
      return and(eq(schema.files.source, source), isNotLinked)
    default:
      return isNotLinked
  }
}

export function getFilesSourceCondition(source: FilesSourceFilter) {
  return and(isListedFile, getSourceOnlyCondition(source))
}

export const filesKindFilters = ['image', 'document'] as const

export type FilesKindFilter = typeof filesKindFilters[number]

const documentMediaTypes = Object.values(DOCUMENT_MEDIA_TYPES)

export function getFilesKindCondition(kind: FilesKindFilter | undefined) {
  switch (kind) {
    case 'image':
      return like(schema.files.type, 'image/%')
    case 'document':
      return inArray(schema.files.type, documentMediaTypes)
    default:
      return undefined
  }
}
