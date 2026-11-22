import type { Experimental_DecisionModel } from 'ai'
import type { RequestEvent } from 'nuxt/server'
import { findSkillInvocation } from '#shared/utils/skills/runtime'
import type { SkillInvocationPartData } from '#shared/utils/skills/runtime'
import { resolveSendFeatures } from '~~/server/utils/features/send-features'
import type { JevDecideResult } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import {
  buildSendPathJevState,
  decideSendPathJev,
} from '~~/server/utils/jev/send-path'
import type { SendPathJevExtra } from '~~/server/utils/jev/send-path'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { prefilterSkills } from '~~/server/utils/skills/jev/prefilter'
import {
  buildSkillSelectionJev,
  pickSkillByScore,
} from '~~/server/utils/skills/jev/questions'
import {
  listCatalogSkills,
  listProjectRuntimeSkills,
} from '~~/server/utils/skills/runtime/load'
import type { RuntimeSkillRow } from '~~/server/utils/skills/runtime/load'
import { collectActivatedSkillIds } from '~~/server/utils/skills/runtime/reinject'

type DbClient = ReturnType<typeof useDb>

const SKILL_SELECTION_ROLE = 'skillSelection'

export interface SkillSelectionPlan {
  candidates: RuntimeSkillRow[]
  catalogSkills: RuntimeSkillRow[]
  messageText: string
  model: Experimental_DecisionModel
  extraJev: SendPathJevExtra | null
  logger: JevLogger
}

async function listSelectableSkills(input: {
  db: DbClient
  userId: number
  projectId: string | null
  catalogSkills: readonly RuntimeSkillRow[]
  storedMessages: ReadonlyArray<{ role: string, parts: unknown[] }>
}): Promise<RuntimeSkillRow[]> {
  if (input.catalogSkills.length === 0) {
    return []
  }

  const excludedIds = new Set(collectActivatedSkillIds(input.storedMessages))

  if (input.projectId) {
    const pinned = await listProjectRuntimeSkills(
      input.db,
      input.userId,
      input.projectId,
    )

    for (const row of pinned) {
      if (row.level === 'always') {
        excludedIds.add(row.id)
      }
    }
  }

  return input.catalogSkills.filter(skill => !excludedIds.has(skill.id))
}

/**
 * The free half of skill selection, run before the send-path Jev call so the
 * questions can ride in it. Cheapest gates first: it returns `null`, with no
 * read at all, for a resume, an empty message or a message that already
 * carries a skill the user attached or typed; then the `skills` flag; then
 * the key and the `skillSelection` role (off until the user switches it on),
 * so a user without them costs one key read and never reads the catalog
 * here. Only then it reads the user's Auto skills (handed on as
 * `catalogSkills`, so `prepareSkillsForSend` does not read them again),
 * drops the ones already active in the chat or pinned to always load, and
 * runs the local BM25 prefilter. No candidate means `extraJev: null` and no
 * Jev call.
 */
export async function prepareSkillSelection(input: {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  userId: number
  projectId: string | null
  isResume: boolean
  messageText: string | null
  newMessageParts: readonly unknown[]
  storedMessages: ReadonlyArray<{ role: string, parts: unknown[] }>
  logger: JevLogger
}): Promise<SkillSelectionPlan | null> {
  const messageText = input.messageText?.trim() ?? ''

  if (
    input.isResume
    || messageText === ''
    || findSkillInvocation(input.newMessageParts)
  ) {
    return null
  }

  try {
    const features = await resolveSendFeatures(
      input.event,
      ['skills'],
      input.logger,
    )

    if (!features.isFeatureActive('skills')) {
      return null
    }

    const model = await resolveJevRoleModel({
      db: input.db,
      userId: input.userId,
      role: SKILL_SELECTION_ROLE,
      logger: input.logger,
    })

    if (!model) {
      return null
    }

    const catalogSkills = await listCatalogSkills(input.db, input.userId)
    const selectable = await listSelectableSkills({
      ...input,
      catalogSkills,
    })
    const matches = prefilterSkills(selectable, messageText)
    const candidates = matches.map(match => match.skill)

    return {
      candidates,
      catalogSkills,
      messageText,
      model,
      extraJev: candidates.length > 0
        ? buildSkillSelectionJev(candidates)
        : null,
      logger: input.logger,
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: { selectionPrepareError: exceptionMessage(exception) },
      },
    })

    return null
  }
}

async function readSkillSelectionResult(
  plan: SkillSelectionPlan,
  extraJev: SendPathJevExtra,
  sharedResult: JevDecideResult | null | undefined,
): Promise<JevDecideResult> {
  if (sharedResult) {
    return sharedResult
  }

  return await decideSendPathJev({
    model: plan.model,
    state: buildSendPathJevState({
      messageText: plan.messageText,
      recentTurns: [],
    }),
    questions: {},
    extra: extraJev,
  })
}

/**
 * Picks at most one skill for the message. `sharedResult` is the answer of
 * the send-path call the Auto web search already made with these questions
 * inside it, so no second request is sent; without it this makes the one
 * call itself. Any failure, timeout or score below the threshold returns
 * `null` and changes nothing: the model still decides from the catalog.
 * Never throws.
 */
export async function resolveSkillSelection(
  plan: SkillSelectionPlan | null,
  sharedResult?: JevDecideResult | null,
): Promise<SkillInvocationPartData | null> {
  if (!plan || !plan.extraJev) {
    return null
  }

  const callsMade = sharedResult ? 0 : 1

  try {
    const result = await readSkillSelectionResult(
      plan,
      plan.extraJev,
      sharedResult,
    )
    const questions = plan.candidates.length

    if (!result.ok) {
      recordJevRoleLog(SKILL_SELECTION_ROLE, {
        status: result.status,
        calls: callsMade,
        questions,
        latencyMs: callsMade ? result.latencyMs : undefined,
        counts: { candidates: questions, shared: sharedResult ? 1 : 0 },
      }, plan.logger)

      return null
    }

    const { index, scores } = pickSkillByScore(
      result.probabilities,
      questions,
    )
    const winner = index === null ? null : plan.candidates[index]!

    recordJevRoleLog(SKILL_SELECTION_ROLE, {
      status: 'ok',
      calls: callsMade,
      questions,
      inputTokens: callsMade ? result.inputTokens ?? undefined : undefined,
      latencyMs: callsMade ? result.latencyMs : undefined,
      counts: {
        candidates: questions,
        shared: sharedResult ? 1 : 0,
        applied: winner ? 1 : 0,
      },
      scores,
    }, plan.logger)

    return winner
      ? {
        skillId: winner.id,
        name: winner.name,
        version: winner.currentVersion,
      }
      : null
  } catch (exception) {
    recordJevRoleLog(SKILL_SELECTION_ROLE, {
      status: 'error',
      calls: callsMade,
    }, plan.logger)
    plan.logger.set({
      attributes: {
        skills: { selectionError: exceptionMessage(exception) },
      },
    })

    return null
  }
}
