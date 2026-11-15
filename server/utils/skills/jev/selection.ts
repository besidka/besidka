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
  messageText: string
  model: Experimental_DecisionModel
  extraJev: SendPathJevExtra
  logger: JevLogger
}

async function listSelectableSkills(input: {
  db: DbClient
  userId: number
  projectId: string | null
  storedMessages: ReadonlyArray<{ role: string, parts: unknown[] }>
}): Promise<RuntimeSkillRow[]> {
  const skills = await listCatalogSkills(input.db, input.userId)

  if (skills.length === 0) {
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

  return skills.filter(skill => !excludedIds.has(skill.id))
}

/**
 * The free half of skill selection, run before the send-path Jev call so the
 * questions can ride in it. It returns `null`, with no Jev call and no key
 * read, when the send is a resume or has no text, the user attached or typed
 * a skill, the `skills` flag is off, no Auto skill is left (already active
 * in the chat, pinned to always load, or none saved) or the local BM25
 * prefilter keeps none. Only with candidates does it read the key and the
 * `skillSelection` role, which is off until the user switches it on.
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

    const selectable = await listSelectableSkills(input)
    const matches = prefilterSkills(selectable, messageText)

    if (matches.length === 0) {
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

    return {
      candidates: matches.map(match => match.skill),
      messageText,
      model,
      extraJev: buildSkillSelectionJev(matches.map(match => match.skill)),
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
    extra: plan.extraJev,
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
  if (!plan) {
    return null
  }

  const callsMade = sharedResult ? 0 : 1

  try {
    const result = await readSkillSelectionResult(plan, sharedResult)
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
