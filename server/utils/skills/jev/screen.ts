import { createError } from 'evlog'
import { JEV_SKILL_SCREENING } from '#shared/utils/jev-policy'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import { toSkillJevFindings } from '#shared/utils/skills/jev-findings'
import type {
  SkillJevMark,
  SkillJevRange,
} from '#shared/utils/skills/jev-findings'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { JevStatus } from '~~/server/utils/jev/client'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import { screenSkillText } from '~~/server/utils/jev/skill-screening'
import type { SkillScreeningFile } from '~~/server/utils/jev/skill-screening'
import {
  readStagedFile,
  lookupSkillStage,
} from '~~/server/utils/skills/import/stage'
import type { SkillStageBucket } from '~~/server/utils/skills/import/stage'
import {
  acquireSkillJevLock,
  readStoredSkillJevResult,
  releaseSkillJevLock,
  readVersionSkillJevResult,
  skillJevMarksKey,
  skillJevStageKey,
  writeStoredSkillJevResult,
} from '~~/server/utils/skills/jev/store'
import type {
  SkillJevKv,
  StoredSkillJevResult,
} from '~~/server/utils/skills/jev/store'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readBlobText,
} from '~~/server/utils/skills/versions/read'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export interface SkillScreenResponse {
  state: 'unavailable' | 'screened' | 'in-progress'
  questionSetVersion: number
  status: JevStatus
  findings: SkillFinding[]
  marks: SkillJevMark[]
  unchecked: SkillJevRange[]
  tooLarge: boolean
  calls: number
  callsSpent: number
  callsLeft: number
}

interface SkillScreenContent {
  description: string
  files: SkillScreeningFile[]
}

const SCREENING_ROLE = 'injectionScreening'
const textDecoder = new TextDecoder()

function toResponse(
  state: SkillScreenResponse['state'],
  stored: StoredSkillJevResult | null,
  calls: number,
): SkillScreenResponse {
  const callsSpent = stored?.callsSpent ?? 0

  return {
    state,
    questionSetVersion: stored?.questionSetVersion
      ?? JEV_SKILL_SCREENING.questionSetVersion,
    status: stored?.status ?? 'ok',
    findings: toSkillJevFindings(stored?.marks ?? []),
    marks: stored?.marks ?? [],
    unchecked: stored?.unchecked ?? [],
    tooLarge: stored?.tooLarge ?? false,
    calls,
    callsSpent,
    callsLeft: state === 'unavailable'
      ? 0
      : Math.max(0, JEV_SKILL_SCREENING.maxCallsPerStage - callsSpent),
  }
}

function isReusable(stored: StoredSkillJevResult, rest: boolean): boolean {
  if (
    stored.questionSetVersion !== JEV_SKILL_SCREENING.questionSetVersion
    || stored.status !== 'ok'
  ) {
    return false
  }

  return !rest || stored.unchecked.length === 0
}

/**
 * The shared body of both screen routes. Without a TypeSafe AI key, or with
 * "Prompt-injection screening" off, the answer is `unavailable` and nothing
 * is read or sent. A stored result of the current question set that finished
 * without a failure is returned as it is (reopening a review costs nothing);
 * only `rest` (the user's "Check the rest") goes past it. One request makes
 * at most `maxCallsPerScreen` calls and one review at most
 * `maxCallsPerStage` in total, counted in the stored result.
 *
 * Parallel requests: only the request that wins the in-flight marker spends;
 * the others answer `in-progress` with what is stored. The winner re-reads the
 * stored result under the marker and writes `callsSpent` plus the calls it
 * plans before the first call, then replaces it with the real count, so the
 * calls of requests that slip past the marker are still counted against the
 * cap. KV is not atomic, so this narrows the race and does not close it; the
 * only spender is the user's own key, from their own session, behind the
 * cross-site guard. A failed call keeps the result as it is: the chunks that
 * were not checked come back as line ranges, and a later request tries them
 * again.
 */
async function runSkillScreen(input: {
  db: DbClient
  userId: number
  rest: boolean
  lockScope: string
  versionSha256: string | null
  kv: SkillJevKv
  readStored: () => Promise<StoredSkillJevResult | null>
  loadContent: () => Promise<SkillScreenContent>
  persist: (result: StoredSkillJevResult) => Promise<void>
  logger?: JevLogger
}): Promise<SkillScreenResponse> {
  const model = await resolveJevRoleModel({
    db: input.db,
    userId: input.userId,
    role: SCREENING_ROLE,
    logger: input.logger,
  })

  if (!model) {
    return toResponse('unavailable', null, 0)
  }

  const initial = await input.readStored()

  if (initial && isReusable(initial, input.rest)) {
    return toResponse('screened', initial, 0)
  }

  const token = await acquireSkillJevLock(input.kv, input.lockScope)

  if (!token) {
    return toResponse('in-progress', initial, 0)
  }

  try {
    const current = await input.readStored()

    if (current && isReusable(current, input.rest)) {
      return toResponse('screened', current, 0)
    }

    const isCurrentSet = current?.questionSetVersion
      === JEV_SKILL_SCREENING.questionSetVersion
    const previous = isCurrentSet ? current : null
    const callsSpent = previous?.callsSpent ?? 0
    const allowance = Math.min(
      JEV_SKILL_SCREENING.maxCallsPerScreen,
      Math.max(0, JEV_SKILL_SCREENING.maxCallsPerStage - callsSpent),
    )
    const content = await input.loadContent()
    const result = (patch: Partial<StoredSkillJevResult>) => {
      return {
        questionSetVersion: JEV_SKILL_SCREENING.questionSetVersion,
        status: previous?.status ?? 'error',
        marks: previous?.marks ?? [],
        unchecked: previous?.unchecked ?? [],
        tooLarge: previous?.tooLarge ?? false,
        callsSpent,
        screenedAt: Date.now(),
        versionSha256: input.versionSha256,
        ...patch,
      } satisfies StoredSkillJevResult
    }

    if (allowance > 0) {
      await input.persist(result({ callsSpent: callsSpent + allowance }))
    }

    const outcome = await screenSkillText({
      model,
      userId: input.userId,
      kv: input.kv,
      description: content.description,
      files: content.files,
      maxCalls: allowance,
      logger: input.logger,
    })
    const stored = result({
      status: outcome.status,
      marks: outcome.marks,
      unchecked: outcome.unchecked,
      tooLarge: outcome.tooLarge,
      callsSpent: callsSpent + outcome.calls,
    })

    await input.persist(stored)

    return toResponse('screened', stored, outcome.calls)
  } finally {
    await releaseSkillJevLock(input.kv, input.lockScope, token)
  }
}

function createStageExpiredError() {
  return createError({
    message: 'This import has expired',
    status: 410,
    code: 'stage-expired',
    why: 'Staged files are kept for one hour, and this import is older or '
      + 'was already installed',
    fix: 'Import the skill again',
  })
}

/**
 * Screens the skill of an import preview. The result is kept next to the
 * stage (not inside the manifest: a commit claims the stage by deleting the
 * manifest, and a late write must not bring it back) with the stage's
 * remaining lifetime, and is read again by the commit.
 */
export async function screenSkillStage(input: {
  db: DbClient
  kv: SkillJevKv
  bucket: SkillStageBucket
  userId: number
  stageId: string
  rest: boolean
  now?: number
  logger?: JevLogger
}): Promise<SkillScreenResponse> {
  const lookup = await lookupSkillStage({
    kv: input.kv,
    userId: input.userId,
    stageId: input.stageId,
    now: input.now,
  })

  if (lookup.state === 'expired') {
    throw createStageExpiredError()
  }

  if (lookup.state === 'foreign') {
    throw createError({
      message: 'Import not found',
      status: 404,
      code: 'stage-not-found',
      why: 'No import with this id belongs to your account',
      fix: 'Import the skill again',
    })
  }

  const { manifest } = lookup
  const key = skillJevStageKey(manifest.stageId)

  return await runSkillScreen({
    db: input.db,
    userId: input.userId,
    rest: input.rest,
    lockScope: manifest.stageId,
    versionSha256: null,
    readStored: () => readStoredSkillJevResult(input.kv, key),
    kv: input.kv,
    logger: input.logger,
    loadContent: async () => {
      const textBySha = new Map<string, string>()

      for (const file of manifest.files) {
        if (textBySha.has(file.sha256)) {
          continue
        }

        const bytes = await readStagedFile({
          bucket: input.bucket,
          manifest,
          sha256: file.sha256,
        })

        if (!bytes) {
          throw createStageExpiredError()
        }

        textBySha.set(file.sha256, textDecoder.decode(bytes))
      }

      return {
        description: manifest.skill.description,
        files: manifest.files.map((file) => {
          return {
            path: file.path,
            kind: file.kind,
            text: textBySha.get(file.sha256) ?? '',
          }
        }),
      }
    },
    persist: async (result) => {
      const remainingSeconds = Math.ceil(
        (manifest.expiresAt - (input.now ?? Date.now())) / 1000,
      )

      await writeStoredSkillJevResult({
        kv: input.kv,
        key,
        result,
        expirationTtl: Math.max(60, remainingSeconds),
      })
    },
  })
}

/**
 * Screens one stored version of a skill (a pending update, a version that
 * needs review, any other). The marks are kept under the version's own key
 * and go with the version.
 */
export async function screenSkillVersion(input: {
  db: DbClient
  kv: SkillJevKv
  bucket: SkillReadBucket
  userId: number
  skillId: string
  version: number
  rest: boolean
  logger?: JevLogger
}): Promise<SkillScreenResponse> {
  const skill = await loadOwnedSkill(input.db, input.userId, input.skillId)
  const row = await loadVersionRow(
    input.db,
    input.userId,
    skill.id,
    input.version,
  )

  if (!row) {
    throw createSkillEditError('version-not-found', {
      message: 'Version not found',
      why: 'The version does not exist, or was removed with the older versions',
      fix: 'Reload the versions list',
    })
  }

  const key = skillJevMarksKey(input.userId, skill.id, input.version)

  return await runSkillScreen({
    db: input.db,
    userId: input.userId,
    rest: input.rest,
    lockScope: `u${input.userId}:${skill.id}:${input.version}`,
    versionSha256: row.sha256,
    readStored: () => {
      return readVersionSkillJevResult({
        kv: input.kv,
        key,
        versionSha256: row.sha256,
      })
    },
    kv: input.kv,
    logger: input.logger,
    loadContent: async () => {
      const files = await loadVersionFiles(
        input.db,
        input.userId,
        skill.id,
        input.version,
      )
      const texts: SkillScreeningFile[] = []

      for (const file of files) {
        texts.push({
          path: file.path,
          kind: file.kind,
          text: await readBlobText({
            bucket: input.bucket,
            userId: input.userId,
            skillId: skill.id,
            blobSha256: file.blobSha256,
          }),
        })
      }

      const skillMarkdown = texts.find((file) => {
        return file.path === SKILL_MD_FILE_NAME
      })
      const parsed = skillMarkdown
        ? parseSkillMarkdown(skillMarkdown.text)
        : null

      return {
        description: parsed?.ok
          ? parsed.frontmatter.description
          : skill.description,
        files: texts,
      }
    },
    persist: async (result) => {
      await writeStoredSkillJevResult({ kv: input.kv, key, result })
    },
  })
}
