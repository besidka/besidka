import {
  SKILL_BLOB_SEGMENT,
  parseSkillBlobKey,
  skillPrefix,
} from '~~/server/utils/skills/storage'
import type { SkillBlobBucket } from '~~/server/utils/skills/storage'

const LIST_PAGE_LIMIT = 1000

/**
 * The blob hashes stored under one skill, from a listing of its blob prefix:
 * one request per 1,000 objects instead of one `head` per file.
 */
export async function listSkillBlobShas(input: {
  bucket: Pick<SkillBlobBucket, 'list'>
  userId: number
  skillId: string
}): Promise<Set<string>> {
  const prefix = `${skillPrefix(input.userId, input.skillId)}${SKILL_BLOB_SEGMENT}/`
  const shas = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await input.bucket.list({
      prefix,
      cursor,
      limit: LIST_PAGE_LIMIT,
    })

    for (const object of page.objects) {
      const parsed = parseSkillBlobKey(object.key)

      if (parsed) {
        shas.add(parsed.sha256)
      }
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return shas
}

export async function findMissingBlobs(input: {
  bucket: Pick<SkillBlobBucket, 'list'>
  userId: number
  skillId: string
  files: Array<{ blobSha256: string }>
}): Promise<string[]> {
  if (input.files.length === 0) {
    return []
  }

  const present = await listSkillBlobShas(input)

  return [...new Set(input.files.map((file) => {
    return file.blobSha256
  }))].filter((sha256) => {
    return !present.has(sha256)
  })
}

export async function hasEveryBlob(input: {
  bucket: Pick<SkillBlobBucket, 'list'>
  userId: number
  skillId: string
  files: Array<{ blobSha256: string }>
}): Promise<boolean> {
  return (await findMissingBlobs(input)).length === 0
}
