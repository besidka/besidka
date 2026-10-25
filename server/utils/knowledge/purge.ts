import { createError } from 'evlog'
import {
  KNOWLEDGE_STORAGE_PREFIX,
  knowledgeProjectPrefix,
  knowledgeUserPrefix,
} from '~~/server/utils/knowledge/storage-keys'

const listPageLimit = 1000
const requiredPrefixStart = `${KNOWLEDGE_STORAGE_PREFIX}/u`

export interface KnowledgePurgeResult {
  objectsDeleted: number
  batches: number
}

export interface KnowledgePurgeBucket {
  list: (options: {
    prefix: string
    cursor?: string
    limit: number
  }) => Promise<{
    objects: Array<{ key: string }>
    truncated: boolean
    cursor?: string
  }>
  delete: (keys: string[]) => Promise<unknown>
}

/**
 * Deletes every R2 object under a knowledge prefix, one listed page at a
 * time. Pages are processed sequentially and each page is removed with a
 * single batch delete, so a purge never holds more than one R2 connection.
 * The prefix guard keeps a malformed argument from ever widening the delete
 * beyond `knowledge/u<userId>/...`.
 */
export async function deleteKnowledgePrefix(
  prefix: string,
  storage: KnowledgePurgeBucket = useFileStorage(),
): Promise<KnowledgePurgeResult> {
  const isGuardedPrefix = prefix.startsWith(requiredPrefixStart)
    && prefix.endsWith('/')

  if (!isGuardedPrefix) {
    throw createError({
      message: 'Refusing to purge a non-knowledge prefix',
      status: 500,
      why: `Prefix "${prefix}" is outside ${requiredPrefixStart}<userId>/`,
      fix: 'Build the prefix with knowledgeUserPrefix or knowledgeProjectPrefix',
    })
  }

  const result: KnowledgePurgeResult = { objectsDeleted: 0, batches: 0 }
  let cursor: string | undefined

  do {
    const page = await storage.list({
      prefix,
      cursor,
      limit: listPageLimit,
    })
    const keys = page.objects.map((object) => {
      return object.key
    })

    if (keys.length > 0) {
      await storage.delete(keys)

      result.objectsDeleted += keys.length
      result.batches++
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return result
}

export async function purgeProjectKnowledge(
  userId: number,
): Promise<KnowledgePurgeResult> {
  return deleteKnowledgePrefix(knowledgeUserPrefix(userId))
}

export async function purgeProjectKnowledgeForProject(
  userId: number,
  projectId: number,
): Promise<KnowledgePurgeResult> {
  return deleteKnowledgePrefix(knowledgeProjectPrefix(userId, projectId))
}
