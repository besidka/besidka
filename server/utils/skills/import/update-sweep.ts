import { and, asc, eq, isNotNull, ne } from 'drizzle-orm'
import {
  isGithubFullSha,
  parseGithubSkillUrl,
} from '#shared/utils/skills/github-url'
import * as schema from '~~/server/db/schema'
import { createBackgroundFeatureCheck } from '~~/server/utils/features/background'
import type { BackgroundFeatureCheck } from '~~/server/utils/features/background'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createGithubClient } from '~~/server/utils/skills/import/github'
import { resolveGithubUpstream } from '~~/server/utils/skills/import/upstream'
import {
  SKILL_UPDATE_RETRY_MS,
  isSkillUpdateDue,
  readSkillUpdateState,
  writeSkillUpdateState,
} from '~~/server/utils/skills/import/update-state'
import type {
  SkillUpdateKv,
  SkillUpdateState,
} from '~~/server/utils/skills/import/update-state'

type DbClient = ReturnType<typeof useDb>

export const SKILL_UPDATE_SWEEP_LIMIT = 50
export const SKILL_UPDATE_SWEEP_FLAG = 'skills'
const SKILL_UPDATE_SWEEP_ROW_LIMIT = 2000
const GITHUB_RATE_LIMIT_CODE = 'github-rate-limited'
const GITHUB_REPOSITORY_GONE_CODE = 'github-not-found'

export interface SkillUpdateSweepResult {
  skillsConsidered: number
  skillsChecked: number
  updatesFound: number
  upToDate: number
  missing: number
  failed: number
  rateLimited: boolean
  usersSkipped: number
  killSwitched: boolean
}

export interface SweepSkillUpdatesInput {
  db: DbClient
  kv: SkillUpdateKv & FeatureKv
  now?: Date
  limit?: number
  fetchImpl?: typeof fetch
  featureConfig?: FeatureEvaluationConfig
  logger?: LoggerLike
}

interface Candidate {
  skillId: string
  userId: number
  owner: string
  repo: string
  sourceRef: string
  sourceVersion: string | null
}

function repositoryKey(candidate: Candidate): string {
  return `${candidate.owner}/${candidate.repo}`.toLowerCase()
}

/**
 * The GitHub skills that are due for a look: not pinned to a commit, not
 * looked at in the last 24 hours, and not waiting out a failed attempt, of
 * accounts that have the `skills` feature. An account is evaluated at most
 * once, before its KV state is read, and no account is evaluated once the
 * run has `limit` skills (`considered` is then a lower bound). One KV read
 * per account (the skills of an account share a state key), never more than
 * `limit` skills in total.
 */
async function listDueSkills(input: {
  db: DbClient
  kv: SkillUpdateKv
  now: number
  limit: number
  featureCheck: BackgroundFeatureCheck
}): Promise<{
  due: Candidate[]
  considered: number
  usersSkipped: number
  states: Map<number, SkillUpdateState>
}> {
  const rows = await input.db.select({
    skillId: schema.skills.id,
    userId: schema.skills.userId,
    sourceUrl: schema.skills.sourceUrl,
    sourceRef: schema.skills.sourceRef,
    sourceVersion: schema.skills.sourceVersion,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.sourceKind, 'github'),
      isNotNull(schema.skills.sourceUrl),
      isNotNull(schema.skills.sourceRef),
      ne(schema.skills.status, 'broken'),
    ))
    .orderBy(asc(schema.skills.userId), asc(schema.skills.id))
    .limit(SKILL_UPDATE_SWEEP_ROW_LIMIT)
  const states = new Map<number, SkillUpdateState>()
  const eligibility = new Map<number, boolean>()
  const due: Candidate[] = []
  let considered = 0

  for (const row of rows) {
    const parsed = parseGithubSkillUrl(row.sourceUrl!)

    if (!parsed.ok || isGithubFullSha(row.sourceRef!)) {
      continue
    }

    if (due.length >= input.limit) {
      considered += eligibility.get(row.userId) === true ? 1 : 0

      continue
    }

    if (!eligibility.has(row.userId)) {
      eligibility.set(
        row.userId,
        await input.featureCheck.isActiveForUser(row.userId),
      )
    }

    if (!eligibility.get(row.userId)) {
      continue
    }

    considered += 1

    if (!states.has(row.userId)) {
      states.set(row.userId, await readSkillUpdateState(input.kv, row.userId))
    }

    if (!isSkillUpdateDue(states.get(row.userId)![row.skillId], input.now)) {
      continue
    }

    due.push({
      skillId: row.skillId,
      userId: row.userId,
      owner: parsed.value.owner,
      repo: parsed.value.repo,
      sourceRef: row.sourceRef!,
      sourceVersion: row.sourceVersion,
    })
  }

  const usersSkipped = [...eligibility.values()].filter((isEligible) => {
    return !isEligible
  }).length

  return { due, considered, usersSkipped, states }
}

function forgetUpdate(
  state: SkillUpdateState,
  skillId: string,
  now: number,
): void {
  state[skillId] = {
    ...state[skillId],
    checkedAt: now,
    retryAfter: undefined,
    latest: undefined,
  }
}

/**
 * Looks, at most once a day per skill, for a newer version of every skill
 * imported from GitHub, and remembers what it found in KV so the manager can
 * show "Update 2.1.3". It reads only the git ref list: no archive is
 * downloaded and no skill is changed, so it cannot say whether the skill's
 * folder changed (only the review can). Skills are checked one after another,
 * grouped by repository so one ref list serves them all, and at most
 * `SKILL_UPDATE_SWEEP_LIMIT` per run. Only accounts that have the `skills`
 * feature are looked at, and a kill switch on `skills` (or `*`) ends the run
 * before the database or GitHub is touched. A repository that is gone clears
 * any remembered update; a network failure changes nothing and waits six
 * hours; a GitHub rate limit ends the run.
 */
export async function sweepSkillUpdates(
  input: SweepSkillUpdatesInput,
): Promise<SkillUpdateSweepResult> {
  const now = (input.now ?? new Date()).getTime()
  const result: SkillUpdateSweepResult = {
    skillsConsidered: 0,
    skillsChecked: 0,
    updatesFound: 0,
    upToDate: 0,
    missing: 0,
    failed: 0,
    rateLimited: false,
    usersSkipped: 0,
    killSwitched: false,
  }
  const featureCheck = createBackgroundFeatureCheck({
    flag: SKILL_UPDATE_SWEEP_FLAG,
    db: input.db,
    kv: input.kv,
    config: input.featureConfig,
    logger: input.logger,
  })

  if (featureCheck.isKillSwitched) {
    result.killSwitched = true

    return result
  }

  const { due, considered, usersSkipped, states } = await listDueSkills({
    db: input.db,
    kv: input.kv,
    now,
    limit: input.limit ?? SKILL_UPDATE_SWEEP_LIMIT,
    featureCheck,
  })
  const dirtyUsers = new Set<number>()
  const byRepository = new Map<string, Candidate[]>()

  result.skillsConsidered = considered
  result.usersSkipped = usersSkipped

  for (const candidate of due) {
    const group = byRepository.get(repositoryKey(candidate)) ?? []

    group.push(candidate)
    byRepository.set(repositoryKey(candidate), group)
  }

  try {
    for (const candidates of byRepository.values()) {
      const client = createGithubClient({
        fetchImpl: input.fetchImpl,
        logger: input.logger,
        kv: input.kv,
      })

      for (const candidate of candidates) {
        const state = states.get(candidate.userId)!

        try {
          const target = await resolveGithubUpstream(
            client,
            { owner: candidate.owner, repo: candidate.repo },
            candidate.sourceRef,
          )

          result.skillsChecked += 1

          if (target.kind === 'found') {
            const isNewer = target.sha !== candidate.sourceVersion
              || target.ref !== candidate.sourceRef

            state[candidate.skillId] = {
              ...state[candidate.skillId],
              checkedAt: now,
              retryAfter: undefined,
              latest: isNewer
                ? { ref: target.ref, sha: target.sha, tag: target.tag }
                : undefined,
            }
            result[isNewer ? 'updatesFound' : 'upToDate'] += 1
          } else {
            forgetUpdate(state, candidate.skillId, now)
            result.missing += 1
          }

          dirtyUsers.add(candidate.userId)
        } catch (exception) {
          const code = (exception as { code?: string }).code

          if (code === GITHUB_REPOSITORY_GONE_CODE) {
            forgetUpdate(state, candidate.skillId, now)
            result.skillsChecked += 1
            result.missing += 1
            dirtyUsers.add(candidate.userId)

            continue
          }

          result.failed += 1

          if (code === GITHUB_RATE_LIMIT_CODE) {
            result.rateLimited = true

            return result
          }

          state[candidate.skillId] = {
            checkedAt: state[candidate.skillId]?.checkedAt ?? 0,
            ...state[candidate.skillId],
            retryAfter: now + SKILL_UPDATE_RETRY_MS,
          }
          dirtyUsers.add(candidate.userId)
        }
      }
    }
  } finally {
    for (const userId of dirtyUsers) {
      try {
        await writeSkillUpdateState(input.kv, userId, states.get(userId)!)
      } catch {
        result.failed += 1
      }
    }
  }

  return result
}
