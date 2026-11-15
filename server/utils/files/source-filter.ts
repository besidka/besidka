import { and, eq, inArray, like } from 'drizzle-orm'
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

export function getFilesSourceCondition(source: FilesSourceFilter) {
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
