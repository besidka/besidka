import type { RequestEvent } from 'nuxt/server'
import { readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { createError } from 'evlog'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_MAX_PATH_LENGTH,
  SKILL_NAME_MAX,
  SKILL_NOTE_MAX,
  SKILL_SAVE_MAX_CHANGES,
  SKILL_EDIT_MAX_FILE_BYTES,
} from '#shared/utils/skills-policy'
import { SKILL_MODES } from '#shared/utils/skills/mode'
import { hasHiddenCharacter } from '#shared/utils/skills/hidden-characters'
import { SKILL_DESCRIPTION_MAX } from '#shared/utils/skills/frontmatter'
import { SKILL_TEMPLATE_IDS } from '#shared/utils/skills/templates'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/

const pathSchema = z.string().min(1).max(SKILL_MAX_PATH_LENGTH * 2)
const noteSchema = z.string().max(SKILL_NOTE_MAX).optional()

const nameSchema = z.string().min(1).max(SKILL_NAME_MAX)

const argumentHintSchema = z.string()
  .max(SKILL_ARGUMENT_HINT_MAX)
  .refine((value) => {
    return !CONTROL_CHARACTER_PATTERN.test(value) && !hasHiddenCharacter(value)
  }, 'The hint cannot contain control or hidden characters')

export const changeSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('put'),
    path: pathSchema,
    content: z.string().max(SKILL_EDIT_MAX_FILE_BYTES),
  }).strict(),
  z.object({
    op: z.literal('delete'),
    path: pathSchema,
  }).strict(),
  z.object({
    op: z.literal('rename'),
    from: pathSchema,
    to: pathSchema,
  }).strict(),
])

export const saveBodySchema = z.object({
  baseVersion: z.number().int().min(1),
  changes: z.array(changeSchema).min(1).max(SKILL_SAVE_MAX_CHANGES),
  note: noteSchema,
}).strict()

export const restoreBodySchema = z.object({
  baseVersion: z.number().int().min(1).optional(),
  note: noteSchema,
}).strict()

const commandSchema = z.string().max(SKILL_NAME_MAX + 1).nullable()

export const createBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('blank'),
    name: nameSchema,
    description: z.string().max(SKILL_DESCRIPTION_MAX).optional(),
    mode: z.enum(SKILL_MODES).optional(),
    command: commandSchema.optional(),
    argumentHint: argumentHintSchema.nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal('template'),
    template: z.enum(SKILL_TEMPLATE_IDS),
    name: nameSchema.optional(),
    mode: z.enum(SKILL_MODES).optional(),
    command: commandSchema.optional(),
  }).strict(),
])

export const settingsBodySchema = z.object({
  mode: z.enum(SKILL_MODES).optional(),
  command: commandSchema.optional(),
  argumentHint: argumentHintSchema.nullable().optional(),
}).strict().refine((body) => {
  return Object.values(body).some((value) => {
    return value !== undefined
  })
}, 'Send at least one setting')

export const versionQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
  path: z.string().min(1).max(SKILL_MAX_PATH_LENGTH * 2).optional(),
})

export const diffQuerySchema = z.object({
  against: z.coerce.number().int().min(1).optional(),
})

/**
 * Every skills route opens the same way: a signed-in user, then the `skills`
 * flag (404 when it is off), then the user id on the request log.
 */
export async function requireSkillsSession(event: RequestEvent) {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'skills')

  const userId = parseInt(session.user.id)

  logger.set({ userId })

  return { logger, userId }
}

export function readSkillIdParam(event: RequestEvent): string {
  return getDecodedRouterParams(event).id ?? ''
}

export function readVersionParam(event: RequestEvent): number {
  const version = Number(getDecodedRouterParams(event).v)

  if (!Number.isSafeInteger(version) || version < 1) {
    throw createSkillEditError('version-not-found', {
      message: 'Version not found',
      why: 'The version is not a positive whole number',
      fix: 'Reload the versions list',
    })
  }

  return version
}

export async function readSkillBody<Schema extends z.ZodType>(
  event: RequestEvent,
  schema: Schema,
  fix: string,
): Promise<z.infer<Schema>> {
  const body = await readValidatedBody(event, schema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: 'The body does not match the expected shape',
      fix,
    })
  }

  return body.data as z.infer<Schema>
}

export function readSkillQuery<Schema extends z.ZodType>(
  query: unknown,
  schema: Schema,
  fix: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(query)

  if (!parsed.success) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: 'The query does not match the expected shape',
      fix,
    })
  }

  return parsed.data as z.infer<Schema>
}
