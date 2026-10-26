import { createError } from 'evlog'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { knowledgeTextByteLength } from '#shared/utils/project-knowledge-schemas'
import { knowledgeItemTextKey } from '~~/server/utils/knowledge/storage-keys'

const TEXT_CONTENT_TYPE = 'text/markdown; charset=utf-8'
const R2_DELETE_BATCH_SIZE = 1000

interface KnowledgeItemTextInput {
  userId: number
  projectId: number
  itemId: number
}

/**
 * Writes an item's extracted text or note body to
 * `knowledge/u<userId>/p<projectId>/items/<itemId>.md`. The key is derived
 * from internal integer ids only (an invalid id throws before R2 is
 * touched) and the text must fit the per-item byte cap.
 */
export async function putKnowledgeItemText(
  input: KnowledgeItemTextInput & { text: string },
): Promise<void> {
  const key = knowledgeItemTextKey(
    input.userId,
    input.projectId,
    input.itemId,
  )

  if (knowledgeTextByteLength(input.text) > KNOWLEDGE_LIMITS.maxItemTextBytes) {
    throw createError({
      message: 'Knowledge text is too large',
      status: 422,
      why: `Item text exceeds ${KNOWLEDGE_LIMITS.maxItemTextBytes} bytes`,
      fix: 'Split the content into smaller items',
    })
  }

  const storage = useFileStorage()

  await storage.put(key, input.text, {
    httpMetadata: { contentType: TEXT_CONTENT_TYPE },
  })
}

/**
 * Reads an item's text object together with the byte size R2 reports for it.
 * Returns null when the object is missing or larger than the per-item cap
 * (anything above the cap was not written by `putKnowledgeItemText`).
 */
export async function readKnowledgeItemText(
  input: KnowledgeItemTextInput,
): Promise<{ text: string, bytes: number } | null> {
  const key = knowledgeItemTextKey(
    input.userId,
    input.projectId,
    input.itemId,
  )
  const storage = useFileStorage()
  const object = await storage.get(key)

  if (!object) {
    return null
  }

  if (object.size > KNOWLEDGE_LIMITS.maxItemTextBytes) {
    return null
  }

  return { text: await object.text(), bytes: object.size }
}

/**
 * Reads an item's text object. Returns null when the object is missing or
 * larger than the per-item cap.
 */
export async function getKnowledgeItemText(
  input: KnowledgeItemTextInput,
): Promise<string | null> {
  const stored = await readKnowledgeItemText(input)

  return stored === null ? null : stored.text
}

export async function deleteKnowledgeItemText(
  input: KnowledgeItemTextInput,
): Promise<void> {
  const key = knowledgeItemTextKey(
    input.userId,
    input.projectId,
    input.itemId,
  )
  const storage = useFileStorage()

  await storage.delete(key)
}

/**
 * Deletes several items' text objects with one R2 batch call per 1,000 keys,
 * so removing a whole folder stays inside the Workers connection and
 * subrequest limits. Keys come from the same server-side builder.
 */
export async function deleteKnowledgeItemTexts(input: {
  userId: number
  projectId: number
  itemIds: number[]
}): Promise<void> {
  const keys = input.itemIds.map((itemId) => {
    return knowledgeItemTextKey(input.userId, input.projectId, itemId)
  })

  if (keys.length === 0) {
    return
  }

  const storage = useFileStorage()

  for (let start = 0; start < keys.length; start += R2_DELETE_BATCH_SIZE) {
    await storage.delete(keys.slice(start, start + R2_DELETE_BATCH_SIZE))
  }
}
