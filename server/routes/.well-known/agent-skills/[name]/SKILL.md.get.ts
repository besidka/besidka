import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

export default defineEventHandler(async (event) => {
  const { name } = getDecodedRouterParams(event)
  const markdown = await readSkillMarkdown(name || '')

  if (!markdown) {
    throw createError({
      message: 'Skill not found',
      status: 404,
      why: `No agent skill is published under "${name}"`,
      fix: `List the published skills at ${AGENT_SKILLS_PATH}/index.json`,
    })
  }

  applyResponseHeaders(event, {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return markdown
})
