import { defineEventHandler } from 'nuxt/server'
import { buildSkillArchive } from '~~/server/utils/skills/versions/files'
import {
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

/**
 * The current version as a .zip with one folder named after the skill, the
 * layout the importer reads back.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)
  const archive = await buildSkillArchive({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
  })

  logger.set({
    attributes: {
      skills: {
        download: {
          version: archive.version,
          files: archive.filesCount,
          bytes: archive.bytes.byteLength,
        },
      },
    },
  })

  return new Response(archive.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archive.name}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
})
