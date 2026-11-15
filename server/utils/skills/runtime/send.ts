import type { ToolSet } from 'ai'
import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import { isAuthoredSkillSource } from '#shared/utils/skills-policy'
import {
  findSkillInvocation,
  toSkillActivationPart,
} from '#shared/utils/skills/runtime'
import type { DataSkillActivationPart } from '#shared/utils/skills/runtime'
import type { UntrustedContentGuard } from '~~/server/utils/ai/tool-loop'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { buildSkillCatalog } from '~~/server/utils/skills/runtime/catalog'
import {
  buildSkillInvocationBlock,
  createSkillInvocationUnavailableError,
} from '~~/server/utils/skills/runtime/invocation'
import type { LoadedSkillInvocation } from '~~/server/utils/skills/runtime/invocation'
import {
  findRunnableSkill,
  listCatalogSkills,
} from '~~/server/utils/skills/runtime/load'
import type { RuntimeSkillRow } from '~~/server/utils/skills/runtime/load'
import type { ProjectSkillsSend } from '~~/server/utils/skills/runtime/project'
import {
  buildActiveSkillsBlock,
  collectActivatedSkillIds,
  collectActivatedSkillNames,
} from '~~/server/utils/skills/runtime/reinject'
import { prepareProjectSkillsForSend } from '~~/server/utils/skills/runtime/project'
import { resolveSkillJevKv } from '~~/server/utils/skills/jev/store'
import { getSkillTools } from '~~/server/utils/skills/runtime/tools'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export interface SkillsSend {
  tools: ToolSet
  toolsRegistered: boolean
  instructionBlock: string | null
  activeSkillsBlock: string | null
  invocationBlock: string | null
  holdsSkillText: boolean
  scriptCandidateSkillIds: string[]
  streamActivations: DataSkillActivationPart[]
  getToolActivations: () => ReturnType<
    ReturnType<typeof getSkillTools>['getActivations']
  >
}

function mergeCatalogSkills(
  autoSkills: readonly RuntimeSkillRow[],
  projectSkills: ProjectSkillsSend,
): Array<RuntimeSkillRow & { preferred: boolean }> {
  const loadedIds = new Set(projectSkills.loadedSkillIds)
  const preferredIds = new Set(
    projectSkills.preferredSkills.map(skill => skill.id),
  )
  const merged = autoSkills
    .filter(skill => !loadedIds.has(skill.id))
    .map((skill) => {
      return { ...skill, preferred: preferredIds.has(skill.id) }
    })
  const mergedIds = new Set(merged.map(skill => skill.id))

  for (const skill of projectSkills.preferredSkills) {
    if (!mergedIds.has(skill.id) && !loadedIds.has(skill.id)) {
      merged.push({ ...skill, preferred: true })
    }
  }

  return merged
}

const EMPTY_SKILLS_SEND: SkillsSend = {
  tools: {},
  toolsRegistered: false,
  instructionBlock: null,
  activeSkillsBlock: null,
  invocationBlock: null,
  holdsSkillText: false,
  scriptCandidateSkillIds: [],
  streamActivations: [],
  getToolActivations: () => [],
}

/**
 * Everything skills add to one send, behind the `skills` flag and nothing
 * for a user without skills:
 *
 * - the catalog of the enabled, model-invocable skills and the two tools,
 *   only when the model supports tool calling and the catalog is not empty;
 * - the skill the user attached to this message (`data-skill-invocation`),
 *   as text for the latest user turn, which works without tool calling;
 * - the skills pinned to the chat's project: the always-loaded ones as a
 *   `<project_skills>` block (every send, also without tool calling), the
 *   preferred ones first in the catalog, whatever their invocation mode;
 *   an Off, unreviewed or broken skill never loads;
 * - the skills the chat keeps active (`data-skill-activation` parts of
 *   earlier answers, plus the attached one when it is Auto), as an
 *   `<active_skills>` block, which is also added when tool calling is off.
 *
 * It never adds a tool other than the two skill tools, whatever a skill
 * says. A user who attached a skill that cannot be read gets the generic
 * 400 for a new message; a stored message just runs without it.
 */
export async function prepareSkillsForSend(input: {
  db: DbClient
  getBucket: () => SkillReadBucket
  userId: number
  projectId?: string | null
  isSkillsActive: boolean
  isToolCallingAllowed: boolean
  family: KnowledgeTokenFamily
  storedMessages: ReadonlyArray<{ role: string, parts: unknown[] }>
  newMessageParts: readonly unknown[]
  userMessageText: string | null
  isStoredUserMessage: boolean
  preloadedInvocation?: LoadedSkillInvocation | null
  guard?: UntrustedContentGuard
  logger: LoggerLike
}): Promise<SkillsSend> {
  if (!input.isSkillsActive) {
    return EMPTY_SKILLS_SEND
  }

  const { db, userId, family, logger } = input
  const bucket = input.getBucket()
  const invocation = findSkillInvocation(input.newMessageParts)
  const invocationResult = invocation
    ? await buildSkillInvocationBlock({
      db,
      bucket,
      userId,
      invocation,
      argumentsText: input.userMessageText ?? '',
      family,
      preloaded: input.preloadedInvocation,
      logger,
    })
    : null

  if (invocation && !invocationResult && !input.isStoredUserMessage) {
    throw createSkillInvocationUnavailableError()
  }

  const streamActivations: DataSkillActivationPart[] = invocationResult
    && invocationResult.keepsActive
    ? [toSkillActivationPart({
      skillId: invocationResult.skillId,
      name: invocationResult.name,
      version: invocationResult.version,
    })]
    : []
  const projectSkills = await prepareProjectSkillsForSend({
    db,
    bucket,
    userId,
    projectId: input.projectId ?? null,
    family,
    skipSkillIds: new Set(
      invocationResult ? [invocationResult.skillId] : [],
    ),
    logger,
  })
  const activatedSkillIds = collectActivatedSkillIds(
    input.storedMessages,
    streamActivations.map(part => part.data.skillId),
  )
  const active = await buildActiveSkillsBlock({
    db,
    bucket,
    userId,
    skillIds: activatedSkillIds,
    skillNames: collectActivatedSkillNames(input.storedMessages),
    skipSkillIds: new Set([
      ...(invocationResult ? [invocationResult.skillId] : []),
      ...projectSkills.loadedSkillIds,
    ]),
    pinnedSkillIds: projectSkills.pinnedSkillIds,
    family,
    logger,
  })
  const catalogSkills: RuntimeSkillRow[] = input.isToolCallingAllowed
    ? mergeCatalogSkills(
      await listCatalogSkills(db, userId),
      projectSkills,
    )
    : []
  const catalog = buildSkillCatalog({ skills: catalogSkills, family })
  let toolSkills = catalogSkills
  let toolsRun: ReturnType<typeof getSkillTools> | null = null

  if (catalog && projectSkills.loadedSkills.length > 0) {
    toolSkills = [...toolSkills, ...projectSkills.loadedSkills]
  }

  if (catalog && invocationResult) {
    const invokedRow = toolSkills.some((skill) => {
      return skill.id === invocationResult.skillId
    })
      ? null
      : await findRunnableSkill(db, userId, invocationResult.skillId)

    toolSkills = invokedRow ? [...toolSkills, invokedRow] : toolSkills
  }

  if (catalog) {
    toolsRun = getSkillTools({
      db,
      bucket,
      userId,
      skills: toolSkills,
      activeSkillIds: new Set([
        ...(active?.activeSkillIds ?? []),
        ...projectSkills.loadedSkillIds,
        ...(invocationResult ? [invocationResult.skillId] : []),
      ]),
      family,
      guard: input.guard,
      kv: resolveSkillJevKv(),
      logger,
    })
  }

  const catalogHoldsImportedText = catalog !== null
    && catalogSkills.some(skill => !isAuthoredSkillSource(skill.sourceKind))
  const instructionBlock = [
    projectSkills.block,
    catalog?.block,
    active?.block,
  ]
    .filter((block): block is string => !!block)
    .join('\n\n') || null
  const activeSkillsBlock = [projectSkills.block, active?.block]
    .filter((block): block is string => !!block)
    .join('\n\n') || null

  logger.set({
    attributes: {
      skills: {
        catalogSize: catalogSkills.length,
        catalogDetail: catalog?.detail ?? null,
        catalogTokens: catalog?.tokens ?? 0,
        toolsRegistered: toolsRun !== null,
        invoked: invocationResult !== null,
        activeCount: active?.activeSkillIds.length ?? 0,
        activeUnavailable: active?.unavailable ?? 0,
        projectLoaded: projectSkills.loadedSkillIds.length,
        projectPreferred: projectSkills.preferredSkills.length,
        activeOmitted: active?.omitted ?? 0,
        catalogHoldsImportedText,
      },
    },
  })

  return {
    tools: toolsRun?.tools ?? {},
    toolsRegistered: toolsRun !== null,
    instructionBlock,
    activeSkillsBlock,
    invocationBlock: invocationResult?.block ?? null,
    holdsSkillText: active !== null
      || projectSkills.block !== null
      || invocationResult !== null
      || catalogHoldsImportedText,
    scriptCandidateSkillIds: [...new Set([
      ...toolSkills.map(skill => skill.id),
      ...(active?.activeSkillIds ?? []),
      ...projectSkills.loadedSkillIds,
      ...(invocationResult ? [invocationResult.skillId] : []),
    ])],
    streamActivations: [...streamActivations, ...projectSkills.activations],
    getToolActivations: toolsRun?.getActivations ?? (() => []),
  }
}
