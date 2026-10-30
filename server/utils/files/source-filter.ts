import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
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
