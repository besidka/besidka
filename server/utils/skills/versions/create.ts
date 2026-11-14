import { and, eq } from 'drizzle-orm'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import {
  BLANK_COMMAND_ARGUMENT_HINT,
  BLANK_SKILL_DESCRIPTION,
  buildBlankSkillFiles,
} from '#shared/utils/skills/blank'
import { renameSkillMarkdown } from '#shared/utils/skills/frontmatter'
import { SKILL_LICENCE_CLASSIFIER_VERSION } from '#shared/utils/skills/licence'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { getSkillTemplate } from '#shared/utils/skills/templates'
import {
  isSkillNameValid,
  normalizeSkillCommand,
} from '#shared/utils/skills-policy'
import type { SkillMode } from '#shared/utils/skills/mode'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  assertLimits,
  createLimitError,
  discardUnfinishedSkill,
  findSkillByName,
  insertSkillWithinLimits,
  reclaimAbandonedPlaceholder,
} from '~~/server/utils/skills/import/commit'
import { putSkillBlobs } from '~~/server/utils/skills/storage'
import {
  findUniqueViolation,
  isUniqueViolation,
} from '~~/server/utils/skills/unique-violation'
import {
  countUserSkills,
  getUserSkillsUsageBytes,
} from '~~/server/utils/skills/usage'
import {
  createSkillCommandTakenError,
  createSkillEditError,
} from '~~/server/utils/skills/versions/errors'
import { resolveSkillCommand } from '~~/server/utils/skills/versions/settings'
import {
  asBatch,
  buildVersionStatements,
} from '~~/server/utils/skills/versions/statements'
import type { SkillWriteBucket } from '~~/server/utils/skills/versions/write'

type DbClient = ReturnType<typeof useDb>

const textEncoder = new TextEncoder()

export type CreateSkillRequest
  = | {
    kind: 'blank'
    name: string
    description?: string
    mode?: SkillMode
    command?: string | null
    argumentHint?: string | null
  }
  | {
    kind: 'template'
    template: string
    name?: string
    mode?: SkillMode
    command?: string | null
  }

export interface CreateAuthoredSkillInput {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  request: CreateSkillRequest
  logger: LoggerLike
}

export interface CreatedSkill {
  id: string
  name: string
  version: 1
  enabled: boolean
  status: 'ready'
  licenseClass: 'authored'
  filesCount: number
  modelInvocable: boolean
  command: string | null
  argumentHint: string | null
}

interface ResolvedNewSkill {
  kind: 'editor' | 'template'
  name: string
  files: Array<{ path: string, content: string }>
  mode: SkillMode
  command: string | null | undefined
  argumentHint: string | null
}

function createInvalidRequestError(why: string, fix: string) {
  return createSkillEditError('invalid-request', {
    message: 'Invalid request',
    why,
    fix,
  })
}

function resolveNewSkill(request: CreateSkillRequest): ResolvedNewSkill {
  if (request.kind === 'template') {
    const template = getSkillTemplate(request.template)

    if (!template) {
      throw createInvalidRequestError(
        'The template does not exist',
        'Pick a template from the list',
      )
    }

    const name = request.name ?? template.name

    return {
      kind: 'template',
      name,
      files: template.files.map((file) => {
        if (file.path !== SKILL_MD_FILE_NAME || name === template.name) {
          return file
        }

        return {
          path: file.path,
          content: renameSkillMarkdown(file.content, name) ?? file.content,
        }
      }),
      mode: request.mode ?? (template.modelInvocable ? 'auto' : 'ask'),
      command: request.command,
      argumentHint: template.argumentHint,
    }
  }

  const hasCommand = normalizeSkillCommand(request.command) !== null

  return {
    kind: 'editor',
    name: request.name,
    files: buildBlankSkillFiles({
      name: request.name,
      description: request.description?.trim() || BLANK_SKILL_DESCRIPTION,
      kind: hasCommand ? 'command' : 'skill',
    }),
    mode: request.mode ?? 'auto',
    command: request.command,
    argumentHint: hasCommand
      ? (request.argumentHint?.trim() || BLANK_COMMAND_ARGUMENT_HINT)
      : null,
  }
}

function createNameTakenError(name: string) {
  return createSkillEditError('name-taken', {
    message: `A skill named ${name} exists`,
    why: 'Skill names are unique per account',
    fix: 'Pick another name',
  })
}

/**
 * Creates a skill the user writes in the app, from nothing (a skill or a
 * command) or from one of Besidka's own templates. It is class `authored`,
 * saved enabled and `ready` with version 1, and no licence tick is needed:
 * the user typed every byte. The row goes in first, as a `broken` placeholder
 * under both caps in one statement (the blob keys carry its id); a failure
 * before the batch removes it again.
 */
export async function createAuthoredSkill(
  input: CreateAuthoredSkillInput,
): Promise<CreatedSkill> {
  const { db, bucket, userId, logger } = input
  const resolved = resolveNewSkill(input.request)

  if (!isSkillNameValid(resolved.name)) {
    throw createInvalidRequestError(
      'The skill name must use lowercase letters, digits and single hyphens, up to 64 characters',
      'Rename the skill',
    )
  }

  const command = await resolveSkillCommand({
    db,
    userId,
    command: resolved.command,
  })
  const modelInvocable = resolved.mode === 'auto'
  const isEnabled = resolved.mode !== 'off'

  const files = resolved.files.map((file) => {
    const bytes = textEncoder.encode(file.content)

    return { path: file.path, bytes, text: file.content }
  })
  const analysis = await analyseSkillFiles({ files, folderName: null })

  if (!analysis.ok) {
    throw createSkillEditError('frontmatter-invalid', {
      message: 'SKILL.md needs a valid name and description',
      why: analysis.message,
      fix: 'Check the name and the description',
    })
  }

  const [skillsCount, usageBytes] = await Promise.all([
    countUserSkills(db, userId),
    getUserSkillsUsageBytes(db, userId),
  ])

  assertLimits({
    skillsCount,
    usageBytes,
    incomingBytes: analysis.totalBytes,
    isNewSkill: true,
  })

  const existing = await findSkillByName(db, userId, resolved.name)

  if (
    existing
    && !await reclaimAbandonedPlaceholder({
      db,
      bucket,
      userId,
      existing,
      now: Date.now(),
    })
  ) {
    throw createNameTakenError(resolved.name)
  }

  const now = new Date()
  let skillId: string | null

  try {
    skillId = await insertSkillWithinLimits(db, {
      createdAt: now,
      updatedAt: now,
      userId,
      name: resolved.name,
      description: analysis.skill.description,
      licenseField: analysis.skill.license,
      licenseClass: 'authored',
      licenseFileSha256: null,
      licenseClassifierVersion: SKILL_LICENCE_CLASSIFIER_VERSION,
      compatibility: analysis.skill.compatibility,
      metadata: analysis.skill.metadata,
      allowedTools: analysis.skill.allowedTools,
      sourceKind: resolved.kind,
      sourceUrl: null,
      sourceRef: null,
      sourcePath: null,
      sourceVersion: null,
      currentVersion: 1,
      pendingVersion: null,
      filesCount: analysis.files.length,
      bytes: analysis.totalBytes,
      enabled: false,
      modelInvocable,
      slashCommand: false,
      slashName: null,
      argumentHint: command === null ? null : resolved.argumentHint,
      allowScripts: false,
      status: 'broken',
      createdVia: 'app',
      createdByClientId: null,
      providerSkillId: null,
      providerSkillVersion: null,
      providerUploadedName: null,
      providerDeletedAt: null,
    })
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createNameTakenError(resolved.name)
    }

    throw exception
  }

  if (skillId === null) {
    throw await createLimitError(db, userId)
  }

  const createdSkillId = skillId

  try {
    await putSkillBlobs({
      bucket,
      userId,
      skillId: createdSkillId,
      contents: files.map((file) => {
        return file.bytes
      }),
    })

    await db.batch(asBatch([
      db.update(schema.skills)
        .set({ status: 'ready', enabled: isEnabled, slashName: command })
        .where(and(
          eq(schema.skills.id, createdSkillId),
          eq(schema.skills.userId, userId),
        )),
      ...buildVersionStatements(db, {
        skillId: createdSkillId,
        userId,
        version: 1,
        origin: resolved.kind,
        sourceKind: resolved.kind,
        sha256: analysis.contentSha256,
        filesCount: analysis.files.length,
        bytes: analysis.totalBytes,
        licenseClass: 'authored',
        licenseFileSha256: null,
        findings: analysis.findingCounts,
      }, analysis.files.map((file) => {
        return {
          path: file.path,
          blobSha256: file.sha256,
          bytes: file.bytes,
          kind: file.kind,
        }
      })),
    ]))
  } catch (exception) {
    await discardUnfinishedSkill({
      db,
      bucket,
      userId,
      skillId: createdSkillId,
    })

    if (findUniqueViolation(exception)?.includes('slash_name')) {
      throw createSkillCommandTakenError(command ?? '')
    }

    throw exception
  }

  logger.set({
    attributes: {
      skills: {
        create: {
          kind: input.request.kind,
          files: analysis.files.length,
          bytes: analysis.totalBytes,
          findings: analysis.findingCounts,
        },
      },
    },
  })

  return {
    id: createdSkillId,
    name: resolved.name,
    version: 1,
    enabled: isEnabled,
    status: 'ready',
    licenseClass: 'authored',
    filesCount: analysis.files.length,
    modelInvocable,
    command,
    argumentHint: command === null ? null : resolved.argumentHint,
  }
}
