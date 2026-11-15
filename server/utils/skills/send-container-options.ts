import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import {
  SKILL_CONTAINER_MAX_SKILLS,
  SKILL_SCRIPTS_GATE_TOOL_NAME,
  SKILL_SCRIPTS_GRANT_KEY,
  buildSkillScriptsApprovalSummary,
  hasSkillScripts,
  hashSkillScriptsSet,
} from '#shared/utils/skills/scripts'
import * as schema from '~~/server/db/schema'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { readBesidkaChatSettings } from '~~/server/utils/besidka-tools/chat-settings'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { ensureProviderSkill } from '~~/server/utils/skills/provider-upload'
import type {
  ProviderSkillReference,
  SkillUploader,
  UploadableSkill,
} from '~~/server/utils/skills/provider-upload'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export type SkillContainerOptions = {
  skills: Array<{
    type: 'custom'
    providerReference: { [provider: string]: string }
    version: string
  }>
}

export interface SkillScriptsGate {
  isActive: boolean
  isGrantMatched: boolean
  skillNames: string[]
  definitionHash: string | null
  tools: ToolSet
  approvalEntries: Map<string, SendToolEntry>
}

export interface SkillScriptsAttachment {
  container: SkillContainerOptions | null
  attachedCount: number
  failed: boolean
}

export interface SkillScriptsRun {
  gate: SkillScriptsGate
  eligibleSkills: UploadableSkill[]
  attach: (input: { isApproved: boolean }) => Promise<SkillScriptsAttachment>
}

const INACTIVE_GATE: SkillScriptsGate = {
  isActive: false,
  isGrantMatched: false,
  skillNames: [],
  definitionHash: null,
  tools: {},
  approvalEntries: new Map(),
}

export const SKILL_SCRIPTS_GATE_DESCRIPTION = 'Ask the user to allow the '
  + 'scripts of their skills to run in Anthropic\'s code sandbox on their own '
  + 'key. Call this once, before you run any script that ships with a skill. '
  + 'If the user denies it, continue without running scripts.'

export const SKILL_SCRIPTS_ALLOWED_TEXT = 'Allowed. The scripts of the '
  + 'listed skills are in the code sandbox. Use the code execution tool to '
  + 'run them.'

export const SKILL_SCRIPTS_UPLOAD_FAILED_TEXT = 'The user allowed scripts, '
  + 'but the skills could not be uploaded to Anthropic. Tell the user, and '
  + 'continue without running scripts.'

export function buildSkillScriptsInstruction(input: {
  skillNames: readonly string[]
  isAttached: boolean
  hasFailed: boolean
}): string {
  const names = input.skillNames.join(', ')

  if (input.hasFailed) {
    return `The scripts of these skills could not be uploaded to the code `
      + `sandbox: ${names}. Do not try to run them; say so if the user asks.`
  }

  if (input.isAttached) {
    return `The scripts of these skills are available in the code sandbox: `
      + `${names}. Run a script with the code execution tool when a skill's `
      + 'instructions call for it.'
  }

  return `These skills ship scripts that can run in the code sandbox: `
    + `${names}. To run one, first call ${SKILL_SCRIPTS_GATE_TOOL_NAME}; `
    + 'the user is asked to allow it. If the user denies it, continue '
    + 'without running scripts.'
}

async function listEligibleSkills(input: {
  db: DbClient
  userId: number
  skillIds: readonly string[]
}): Promise<UploadableSkill[]> {
  const decodable = [...new Set(input.skillIds)]
    .filter(isDecodableSkillPublicId)

  if (decodable.length === 0) {
    return []
  }

  const rows = await input.db.select({
    id: schema.skills.id,
    name: schema.skills.name,
    currentVersion: schema.skills.currentVersion,
    providerSkillId: schema.skills.providerSkillId,
    providerSkillVersion: schema.skills.providerSkillVersion,
    providerUploadedName: schema.skills.providerUploadedName,
    providerDeletedAt: schema.skills.providerDeletedAt,
  })
    .from(schema.skills)
    .where(and(
      inArray(schema.skills.id, decodable),
      eq(schema.skills.userId, input.userId),
      eq(schema.skills.enabled, true),
      eq(schema.skills.allowScripts, true),
      ne(schema.skills.status, 'broken'),
      ne(schema.skills.licenseClass, 'restricted'),
    ))

  if (rows.length === 0) {
    return []
  }

  const files = await input.db.select({
    skillId: schema.skillFiles.skillId,
    version: schema.skillFiles.version,
    kind: schema.skillFiles.kind,
  })
    .from(schema.skillFiles)
    .where(and(
      eq(schema.skillFiles.userId, input.userId),
      inArray(schema.skillFiles.skillId, rows.map(row => row.id)),
      eq(schema.skillFiles.kind, 'script'),
    ))

  return rows
    .filter((row) => {
      return hasSkillScripts(files.filter((file) => {
        return file.skillId === row.id && file.version === row.currentVersion
      }))
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, SKILL_CONTAINER_MAX_SKILLS)
}

function buildGateTool(input: {
  getAttachment: () => SkillScriptsAttachment | null
}) {
  return withFollowUpTurn(tool({
    description: SKILL_SCRIPTS_GATE_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => {
      return input.getAttachment()?.failed
        ? SKILL_SCRIPTS_UPLOAD_FAILED_TEXT
        : SKILL_SCRIPTS_ALLOWED_TEXT
    },
  }))
}

/**
 * Everything the skill scripts add to one send, or nothing. It applies only
 * when all of these hold: the skills runtime and `skills.scripts` are on for
 * the user (Labs opt-in included), tool approvals are on, the route is the
 * direct Anthropic provider (never a gateway) with the "Run code" tool active
 * for this message, and the skill is enabled for the chat, has its "Allow
 * scripts" toggle on and ships a script in its current version.
 *
 * The consent cannot sit on the code execution call, because the provider
 * runs that inside its own response. It sits on whether the skills reach the
 * container at all: until the chat holds a grant for this exact set of skill
 * versions, a small gate tool asks the user (the consent rule of the approval
 * policy), and the skills are attached only on the continuation that carries
 * an approved answer. A denial leaves the send exactly as S-3 left it.
 */
export async function prepareSkillScriptsForSend(input: {
  db: DbClient
  getBucket: () => SkillReadBucket
  userId: number
  chatPublicId: string
  candidateSkillIds: readonly string[]
  isFeatureActive: boolean
  isApprovalsActive: boolean
  isToolCallingAllowed: boolean
  isDirectAnthropic: boolean
  isCodeExecutionActive: boolean
  apiKey: string | null
  logger: LoggerLike
  uploader?: SkillUploader
  fetcher?: typeof fetch
}): Promise<SkillScriptsRun> {
  const inactive: SkillScriptsRun = {
    gate: INACTIVE_GATE,
    eligibleSkills: [],
    attach: async () => ({ container: null, attachedCount: 0, failed: false }),
  }

  if (
    !input.isFeatureActive
    || !input.isApprovalsActive
    || !input.isToolCallingAllowed
    || !input.isDirectAnthropic
    || !input.isCodeExecutionActive
    || !input.apiKey
  ) {
    return inactive
  }

  const apiKey = input.apiKey
  const eligibleSkills = await listEligibleSkills({
    db: input.db,
    userId: input.userId,
    skillIds: input.candidateSkillIds,
  })

  if (eligibleSkills.length === 0) {
    return inactive
  }

  const definitionHash = await hashSkillScriptsSet(eligibleSkills)
  const settings = await readBesidkaChatSettings(
    input.db,
    input.userId,
    input.chatPublicId,
  )
  const isGrantMatched = Object.hasOwn(
    settings.alwaysAllowTools,
    SKILL_SCRIPTS_GRANT_KEY,
  ) && settings.alwaysAllowTools[SKILL_SCRIPTS_GRANT_KEY] === definitionHash
  const skillNames = eligibleSkills.map(skill => skill.name)
  const approvalEntries = new Map<string, SendToolEntry>()

  if (!isGrantMatched) {
    approvalEntries.set(SKILL_SCRIPTS_GATE_TOOL_NAME, {
      descriptor: {
        family: 'native',
        access: 'write',
        toolName: SKILL_SCRIPTS_GATE_TOOL_NAME,
        destructiveHint: false,
        consentGate: true,
        definitionHash,
      },
      summary: buildSkillScriptsApprovalSummary(skillNames),
      taint: null,
      readSource: null,
      alwaysGrant: null,
      alwaysGrantWhenTainted: false,
      connector: null,
    })
  }

  let attachment: SkillScriptsAttachment | null = null

  async function attach(attachInput: {
    isApproved: boolean
  }): Promise<SkillScriptsAttachment> {
    if (attachment) {
      return attachment
    }

    if (!attachInput.isApproved && !isGrantMatched) {
      return { container: null, attachedCount: 0, failed: false }
    }

    const references: ProviderSkillReference[] = []

    try {
      for (const skill of eligibleSkills) {
        references.push(await ensureProviderSkill({
          db: input.db,
          bucket: input.getBucket(),
          userId: input.userId,
          skill,
          apiKey,
          logger: input.logger,
          uploader: input.uploader,
          fetcher: input.fetcher,
        }))
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          skills: {
            scripts: { attachFailed: exceptionMessage(exception) },
          },
        },
      })
      attachment = { container: null, attachedCount: 0, failed: true }

      return attachment
    }

    attachment = {
      container: {
        skills: references.map((reference) => {
          return {
            type: 'custom' as const,
            providerReference: { anthropic: reference.providerSkillId },
            version: reference.providerVersion,
          }
        }),
      },
      attachedCount: references.length,
      failed: false,
    }

    const gateEntry = approvalEntries.get(SKILL_SCRIPTS_GATE_TOOL_NAME)

    if (gateEntry) {
      gateEntry.userGrants = {
        always: null,
        chat: {
          definitionHash,
          connectorId: null,
          toolName: SKILL_SCRIPTS_GATE_TOOL_NAME,
        },
      }
    }

    input.logger.set({
      attributes: {
        skills: {
          scripts: {
            attached: references.length,
            grant: isGrantMatched,
          },
        },
      },
    })

    return attachment
  }

  const gateTools: ToolSet = isGrantMatched
    ? {}
    : {
      [SKILL_SCRIPTS_GATE_TOOL_NAME]: buildGateTool({
        getAttachment: () => attachment,
      }) as ToolSet[string],
    }
  return {
    gate: {
      isActive: true,
      isGrantMatched,
      skillNames,
      definitionHash,
      tools: gateTools,
      approvalEntries,
    },
    eligibleSkills,
    attach,
  }
}
