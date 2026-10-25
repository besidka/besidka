import { createError } from 'evlog'

export const KNOWLEDGE_STORAGE_PREFIX = 'knowledge'

function assertInternalId(value: number, label: string): void {
  if (Number.isSafeInteger(value) && value > 0) {
    return
  }

  throw createError({
    message: 'Invalid knowledge storage key',
    status: 500,
    why: `${label} must be a positive safe integer, received ${value}`,
    fix: 'Pass the internal integer id, never a public id or client input',
  })
}

export function knowledgeUserPrefix(userId: number): string {
  assertInternalId(userId, 'userId')

  return `${KNOWLEDGE_STORAGE_PREFIX}/u${userId}/`
}

export function knowledgeProjectPrefix(
  userId: number,
  projectId: number,
): string {
  assertInternalId(projectId, 'projectId')

  return `${knowledgeUserPrefix(userId)}p${projectId}/`
}

export function knowledgeItemTextKey(
  userId: number,
  projectId: number,
  itemId: number,
): string {
  assertInternalId(itemId, 'itemId')

  return `${knowledgeProjectPrefix(userId, projectId)}items/${itemId}.md`
}

export function knowledgePackKey(
  userId: number,
  projectId: number,
  version: number,
): string {
  assertInternalId(version, 'version')

  return `${knowledgeProjectPrefix(userId, projectId)}pack/v${version}.jsonl.gz`
}

export function knowledgePackIndexKey(
  userId: number,
  projectId: number,
  version: number,
): string {
  assertInternalId(version, 'version')

  return `${knowledgeProjectPrefix(userId, projectId)}pack/v${version}.index.json.gz`
}
