import { createError } from 'evlog'
import { JEV_SKILL_SCREENING } from '#shared/utils/jev-policy'
import { toSkillJevFindingCounts } from '#shared/utils/skills/jev-findings'
import type {
  SkillJevMark,
  SkillJevRange,
} from '#shared/utils/skills/jev-findings'
import type { JevStatus } from '~~/server/utils/jev/client'

export interface StoredSkillJevResult {
  questionSetVersion: number
  status: JevStatus
  marks: SkillJevMark[]
  unchecked: SkillJevRange[]
  tooLarge: boolean
  callsSpent: number
  screenedAt: number
  versionSha256: string | null
}

export interface SkillJevKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
  list?: (options: { prefix: string, cursor?: string }) => Promise<{
    keys: Array<{ name: string }>
    list_complete: boolean
    cursor?: string
  }>
}

export const SKILL_JEV_STAGE_KEY_PREFIX = 'skills:jev-stage:'
export const SKILL_JEV_MARKS_KEY_PREFIX = 'skills:marks:'
export const SKILL_JEV_LOCK_KEY_PREFIX = 'skills:jev-lock:'
export const SKILL_JEV_LOCK_TTL_SECONDS = 60

const MAX_PURGE_PAGES = 50

export function skillJevStageKey(stageId: string): string {
  return `${SKILL_JEV_STAGE_KEY_PREFIX}${stageId}`
}

export function skillJevLockKey(scope: string): string {
  return `${SKILL_JEV_LOCK_KEY_PREFIX}${scope}`
}

export function skillJevMarksUserPrefix(userId: number): string {
  return `${SKILL_JEV_MARKS_KEY_PREFIX}u${userId}:`
}

/**
 * Where the marks of one skill version live. The key holds line ranges,
 * scores and counts, never text, and goes with the version.
 */
export function skillJevMarksKey(
  userId: number,
  skillId: string,
  version: number,
): string {
  return `${skillJevMarksUserPrefix(userId)}${skillId}:${version}`
}

/**
 * The binding of the current request, or null where there is none (unit
 * tests, a context without bindings), so cleanup never fails for want of it.
 */
export function resolveSkillJevKv(): SkillJevKv | null {
  try {
    return useKV() as unknown as SkillJevKv
  } catch {
    return null
  }
}

function isStoredResult(value: unknown): value is StoredSkillJevResult {
  const candidate = value as Partial<StoredSkillJevResult> | null

  return typeof candidate === 'object'
    && candidate !== null
    && typeof candidate.questionSetVersion === 'number'
    && typeof candidate.status === 'string'
    && Array.isArray(candidate.marks)
    && Array.isArray(candidate.unchecked)
    && typeof candidate.callsSpent === 'number'
}

export async function readStoredSkillJevResult(
  kv: SkillJevKv,
  key: string,
): Promise<StoredSkillJevResult | null> {
  try {
    const raw = await kv.get(key)

    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    return isStoredResult(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeStoredSkillJevResult(input: {
  kv: SkillJevKv
  key: string
  result: StoredSkillJevResult
  expirationTtl?: number
}): Promise<boolean> {
  try {
    await input.kv.put(input.key, JSON.stringify(input.result), {
      expirationTtl: input.expirationTtl,
    })

    return true
  } catch {
    return false
  }
}

/**
 * An in-flight marker for one screen (a stage or a version), so a second
 * request that arrives while the first is calling TypeSafe AI is told so
 * instead of spending too. KV has no compare-and-set: the marker is read, then
 * written with a random token, then read back, and only the request that finds
 * its own token goes on. That narrows the race but cannot close it, so the
 * budget is also reserved before the calls start. The marker expires after
 * `SKILL_JEV_LOCK_TTL_SECONDS` (the KV minimum), so a request that died never
 * blocks a review for longer. Returns the token, or null when someone else
 * holds the marker or KV cannot be used (the request then does not spend).
 */
export async function acquireSkillJevLock(
  kv: SkillJevKv,
  scope: string,
): Promise<string | null> {
  const key = skillJevLockKey(scope)
  const token = crypto.randomUUID()

  try {
    if (await kv.get(key)) {
      return null
    }

    await kv.put(key, token, { expirationTtl: SKILL_JEV_LOCK_TTL_SECONDS })

    return (await kv.get(key)) === token ? token : null
  } catch {
    return null
  }
}

export async function releaseSkillJevLock(
  kv: SkillJevKv,
  scope: string,
  token: string,
): Promise<void> {
  const key = skillJevLockKey(scope)

  try {
    if ((await kv.get(key)) === token) {
      await kv.delete(key)
    }
  } catch {
    return
  }
}

/**
 * The stored result of one version, only when it was made for the content
 * that version has now. Version numbers are reused (after a reject, a prune
 * or a D1 restore), so a marks entry that outlived its version must never
 * answer for different text.
 */
export async function readVersionSkillJevResult(input: {
  kv: SkillJevKv
  key: string
  versionSha256: string
}): Promise<StoredSkillJevResult | null> {
  const result = await readStoredSkillJevResult(input.kv, input.key)

  return result?.versionSha256 === input.versionSha256 ? result : null
}

/**
 * The counts that go into `skill_versions.findings` at commit or accept, or
 * nothing when no check ran for the current question set.
 */
export function toStoredJevFindingCounts(
  result: StoredSkillJevResult | null,
): Record<string, number> {
  if (
    !result
    || result.questionSetVersion !== JEV_SKILL_SCREENING.questionSetVersion
  ) {
    return {}
  }

  return toSkillJevFindingCounts(result)
}

/**
 * Best effort and sequential (KV has no batch delete): a marks entry that
 * outlives its version only names line ranges, and can never fail the
 * operation that removed the version.
 */
export async function deleteSkillJevMarks(input: {
  userId: number
  skillId: string
  versions: number[]
  kv?: SkillJevKv | null
}): Promise<void> {
  const kv = input.kv === undefined ? resolveSkillJevKv() : input.kv

  if (!kv) {
    return
  }

  for (const version of input.versions) {
    try {
      await kv.delete(skillJevMarksKey(input.userId, input.skillId, version))
    } catch {
      continue
    }
  }
}

export async function deleteSkillJevStage(input: {
  stageId: string
  kv?: SkillJevKv | null
}): Promise<void> {
  const kv = input.kv === undefined ? resolveSkillJevKv() : input.kv

  if (!kv) {
    return
  }

  try {
    await kv.delete(skillJevStageKey(input.stageId))
  } catch {
    return
  }
}

/**
 * Account deletion: every marks entry of the user, found by prefix. Marks
 * name file paths, which are skill content, so unlike the per-version
 * deletes this one does not swallow a failure: `purgeUserSkills` rethrows it
 * and the account deletion stays retryable (deleted keys are gone on the
 * retry). Without a binding there is nothing to purge. The chunk cache
 * (`skills:jev:u<userId>:...`) holds scores under hashes, no text or path,
 * and expires within 30 days, so it is left to expire.
 */
export async function purgeUserSkillJevMarks(input: {
  userId: number
  kv?: SkillJevKv | null
}): Promise<void> {
  const kv = input.kv === undefined ? resolveSkillJevKv() : input.kv

  if (!kv?.list) {
    return
  }

  let cursor: string | undefined

  for (let page = 0; page < MAX_PURGE_PAGES; page++) {
    const listed = await kv.list({
      prefix: skillJevMarksUserPrefix(input.userId),
      cursor,
    })

    for (const entry of listed.keys) {
      await kv.delete(entry.name)
    }

    if (listed.list_complete) {
      return
    }

    cursor = listed.cursor
  }

  throw createError({
    message: 'Skill marks purge stopped before listing finished',
    status: 500,
    why: `More than ${MAX_PURGE_PAGES} pages of marks entries were listed`,
    fix: 'Retry the account deletion; the remaining entries were not deleted',
  })
}

/**
 * Accepting a pending version writes a new row at the next number over the
 * same files, so its marks move with it. The old key goes only after the new
 * one was written, and also when the entry belongs to other content, since
 * its version is gone either way. Returns the moved result, or null when the
 * pending version was never checked (or was checked for other content).
 */
export async function moveSkillJevMarks(input: {
  userId: number
  skillId: string
  fromVersion: number
  toVersion: number
  versionSha256: string
  kv?: SkillJevKv | null
}): Promise<StoredSkillJevResult | null> {
  const kv = input.kv === undefined ? resolveSkillJevKv() : input.kv

  if (!kv) {
    return null
  }

  const result = await readVersionSkillJevResult({
    kv,
    key: skillJevMarksKey(input.userId, input.skillId, input.fromVersion),
    versionSha256: input.versionSha256,
  })

  if (!result) {
    await deleteSkillJevMarks({
      userId: input.userId,
      skillId: input.skillId,
      versions: [input.fromVersion],
      kv,
    })

    return null
  }

  const isWritten = await writeStoredSkillJevResult({
    kv,
    key: skillJevMarksKey(input.userId, input.skillId, input.toVersion),
    result,
  })

  if (isWritten) {
    await deleteSkillJevMarks({
      userId: input.userId,
      skillId: input.skillId,
      versions: [input.fromVersion],
      kv,
    })
  }

  return result
}
