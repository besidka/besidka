import { defineEventHandler } from 'nuxt/server'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  createSkillImportPreview,
  readSkillUpload,
} from '~~/server/utils/skills/import/preview'
import { enforceSkillImportRateLimit } from '~~/server/utils/skills/import/rate-limit'
import {
  createSkillSourceVersion,
  readSkillArchive,
} from '~~/server/utils/skills/import/zip'

/**
 * Multipart `file` (.zip or .skill) in, a staged preview out. Nothing is
 * installed here: the skill exists only after `import/commit`.
 *
 * @example
 * const preview = await $fetch('/api/v1/skills/import/preview', {
 *   method: 'POST',
 *   body: formData,
 * })
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

  const upload = await readSkillUpload(event)
  const archive = readSkillArchive(upload.bytes)

  logger.set({ userId })

  return await createSkillImportPreview({
    kv: useKV(),
    bucket: useFileStorage(),
    userId,
    source: 'zip',
    sourceVersion: await createSkillSourceVersion(upload.bytes),
    fileName: upload.fileName,
    files: archive.files,
    folderName: archive.folderName,
    archiveWarnings: archive.warnings,
    logger,
  })
})
