import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { SKILL_MAX_SKILL_MD_BYTES } from '#shared/utils/skills-policy'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'
import { createSkillImportPreview } from '~~/server/utils/skills/import/preview'
import { enforceSkillImportRateLimit } from '~~/server/utils/skills/import/rate-limit'
import { createSkillSourceVersion } from '~~/server/utils/skills/import/zip'

const bodySchema = z.object({
  text: z.string().min(1).max(SKILL_MAX_SKILL_MD_BYTES),
})

const textEncoder = new TextEncoder()
const TEXT_BODY_MAX_BYTES = 1024 * 1024

/**
 * Pasted `SKILL.md` text in, a staged preview out. A paste is an import:
 * it keeps the licence gate and class `none` without a licence file, and it
 * is committed disabled through `import/commit` like an archive.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'skills')

  const userId = parseInt(session.user.id)

  await enforceSkillImportRateLimit(event, userId)

  assertRequestBodyLength(event, TEXT_BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: body.error.message,
      fix: 'Send { text } with the SKILL.md content',
    })
  }

  const bytes = textEncoder.encode(body.data.text)

  if (bytes.byteLength > SKILL_MAX_SKILL_MD_BYTES) {
    throw createSkillImportError(
      'skill-md-too-large',
      'SKILL.md is over 256 KiB',
    )
  }

  if (body.data.text.includes('\u0000')) {
    throw createSkillImportError(
      'archive-binary-content',
      'The text contains binary data',
    )
  }

  logger.set({ userId })

  return await createSkillImportPreview({
    kv: useKV(),
    bucket: useFileStorage(),
    userId,
    source: 'text',
    sourceVersion: await createSkillSourceVersion(bytes),
    fileName: null,
    files: [{ path: SKILL_MD_FILE_NAME, bytes, text: body.data.text }],
    folderName: null,
    archiveWarnings: [],
    logger,
  })
})
