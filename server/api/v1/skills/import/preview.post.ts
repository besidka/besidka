import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import {
  defineEventHandler,
  getRequestHeader,
  readValidatedBody,
} from 'nuxt/server'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  githubImportBodySchema,
  previewGithubImport,
} from '~~/server/utils/skills/import/github-preview'
import {
  createSkillImportPreview,
  readSkillUpload,
} from '~~/server/utils/skills/import/preview'
import { enforceSkillImportRateLimit } from '~~/server/utils/skills/import/rate-limit'
import {
  createSkillSourceVersion,
  readSkillArchive,
} from '~~/server/utils/skills/import/zip'

const URL_BODY_MAX_BYTES = 4096

function isJsonRequest(event: RequestEvent) {
  return (getRequestHeader(event, 'content-type') ?? '')
    .toLowerCase()
    .startsWith('application/json')
}

/**
 * Multipart `file` (.zip or .skill) or JSON `{ url, path? }` (a GitHub link,
 * behind `skills.import-url`) in, a staged preview out. A link to a repository
 * that holds several skills answers with `{ pick }` instead, and the link is
 * sent again with the chosen `path`. Nothing is installed here: the skill
 * exists only after `import/commit`.
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

  const isUrlImport = isJsonRequest(event)

  if (isUrlImport) {
    await requireFeature(event, 'skills.import-url')
  }

  const userId = parseInt(session.user.id)

  await enforceSkillImportRateLimit(event, userId)

  if (isUrlImport) {
    assertRequestBodyLength(event, URL_BODY_MAX_BYTES)

    const body = await readValidatedBody(
      event,
      githubImportBodySchema.safeParse,
    )

    if (body.error) {
      throw createError({
        message: 'Invalid request',
        status: 400,
        code: 'invalid-request',
        why: body.error.message,
        fix: 'Send { url } with a github.com link',
      })
    }

    logger.set({ userId })

    return await previewGithubImport({
      kv: useKV(),
      bucket: useFileStorage(),
      userId,
      body: body.data,
      logger,
    })
  }

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
