import { formatGithubSourceVersion } from '#shared/utils/skills/release'

export const SKILL_UPDATE_STATE_PREFIX = 'skills:update-state:'
export const SKILL_UPDATE_STATE_TTL_SECONDS = 45 * 24 * 60 * 60
export const SKILL_UPDATE_RECHECK_MS = 24 * 60 * 60 * 1000
export const SKILL_UPDATE_RETRY_MS = 6 * 60 * 60 * 1000

export interface SkillUpdateTarget {
  ref: string
  sha: string
  tag: string | null
}

export interface SkillUpdateRecord {
  checkedAt: number
  retryAfter?: number
  latest?: SkillUpdateTarget
  seen?: SkillUpdateTarget
}

export type SkillUpdateState = Record<string, SkillUpdateRecord>

export interface SkillUpdateKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
}

export interface SkillUpdateAvailable {
  label: string
  ref: string
}

function stateKey(userId: number): string {
  return `${SKILL_UPDATE_STATE_PREFIX}${userId}`
}

function isTarget(value: unknown): value is SkillUpdateTarget {
  const record = value as Record<string, unknown> | null

  return !!record
    && typeof record.ref === 'string'
    && typeof record.sha === 'string'
}

/**
 * What the sweep and the update check remember about each skill of one
 * account: when it was last looked at, the newest upstream version found
 * (`latest`) and the version the user's review already showed to hold no
 * change for the skill (`seen`). One KV key per account, so the skills list
 * costs one read. Nothing here is a source of truth: losing it only loses a
 * badge, and the 45-day lifetime is refreshed on every write. A read that
 * fails or finds damaged JSON is an empty state.
 */
export async function readSkillUpdateState(
  kv: SkillUpdateKv,
  userId: number,
): Promise<SkillUpdateState> {
  try {
    const raw = await kv.get(stateKey(userId))
    const parsed = raw ? JSON.parse(raw) as SkillUpdateState : {}
    const state: SkillUpdateState = {}

    for (const [skillId, record] of Object.entries(parsed)) {
      if (typeof record?.checkedAt !== 'number') {
        continue
      }

      state[skillId] = {
        checkedAt: record.checkedAt,
        retryAfter: typeof record.retryAfter === 'number'
          ? record.retryAfter
          : undefined,
        latest: isTarget(record.latest) ? record.latest : undefined,
        seen: isTarget(record.seen) ? record.seen : undefined,
      }
    }

    return state
  } catch {
    return {}
  }
}

export async function writeSkillUpdateState(
  kv: SkillUpdateKv,
  userId: number,
  state: SkillUpdateState,
): Promise<void> {
  await kv.put(stateKey(userId), JSON.stringify(state), {
    expirationTtl: SKILL_UPDATE_STATE_TTL_SECONDS,
  })
}

export function isSkillUpdateDue(
  record: SkillUpdateRecord | undefined,
  now: number,
): boolean {
  if (!record) {
    return true
  }

  return now >= record.checkedAt + SKILL_UPDATE_RECHECK_MS
    && now >= (record.retryAfter ?? 0)
}

function isSameTarget(
  target: SkillUpdateTarget,
  other: { ref: string | null, sha: string | null },
): boolean {
  return target.ref === other.ref && target.sha === other.sha
}

/**
 * The "Update 2.1.3" the manager shows, or null. It needs a newer upstream
 * version that is not the one the skill is on and not one the user's review
 * already found to hold no change for this skill. A release tag cannot tell
 * whether this skill's folder changed, so the badge stays until the review
 * says so ("No changes in 2.1.3") and `seen` records it.
 */
export function getSkillUpdateAvailable(
  record: SkillUpdateRecord | undefined,
  skill: { sourceRef: string | null, sourceVersion: string | null },
): SkillUpdateAvailable | null {
  const latest = record?.latest

  if (!latest) {
    return null
  }

  if (
    isSameTarget(latest, {
      ref: skill.sourceRef,
      sha: skill.sourceVersion,
    })
    || (record.seen && isSameTarget(record.seen, latest))
  ) {
    return null
  }

  return {
    label: formatGithubSourceVersion({
      sourceRef: latest.ref,
      sourceVersion: latest.sha,
    }) ?? latest.sha.slice(0, 7),
    ref: latest.ref,
  }
}

/**
 * The review found no change for the skill at `target`: remember that, so
 * the badge for this version goes away. Best effort, never throws.
 */
export async function markSkillUpdateSeen(
  kv: SkillUpdateKv | undefined,
  input: { userId: number, skillId: string, target: SkillUpdateTarget },
): Promise<void> {
  if (!kv) {
    return
  }

  try {
    const state = await readSkillUpdateState(kv, input.userId)
    const record = state[input.skillId]

    state[input.skillId] = {
      checkedAt: record?.checkedAt ?? Date.now(),
      latest: input.target,
      seen: input.target,
    }
    await writeSkillUpdateState(kv, input.userId, state)
  } catch {
    return
  }
}

/**
 * The check found the skill on the newest version: drop any remembered
 * update. Best effort, never throws.
 */
export async function clearSkillUpdate(
  kv: SkillUpdateKv | undefined,
  input: { userId: number, skillId: string },
): Promise<void> {
  if (!kv) {
    return
  }

  try {
    const state = await readSkillUpdateState(kv, input.userId)
    const record = state[input.skillId]

    if (!record?.latest) {
      return
    }

    state[input.skillId] = { ...record, latest: undefined }
    await writeSkillUpdateState(kv, input.userId, state)
  } catch {
    return
  }
}
