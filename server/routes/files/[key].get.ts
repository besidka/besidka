import type { R2ObjectBody } from '@cloudflare/workers-types'
import { hasShareTokenFileAccess } from '~~/server/utils/files/file-share-access'

export default defineEventHandler(async (event) => {
  const { key: storageKey } = getRouterParams(event)

  if (!storageKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing file Storage Key',
    })
  }

  const file = await useDb().query.files.findFirst({
    where(files, { eq }) {
      return eq(files.storageKey, storageKey)
    },
    columns: {
      id: true,
      userId: true,
      storageKey: true,
      type: true,
      size: true,
    },
  })

  if (!file) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found',
    })
  }

  const session = await useUserSession()
  const userId = session ? parseInt(session.user.id) : null
  let hasAccess = userId === file.userId

  if (!hasAccess) {
    const query = getQuery(event)
    const tokenFromHeader = getRequestHeader(event, 'x-file-access-token')
    const tokenFromQuery = typeof query.token === 'string'
      ? query.token
      : undefined
    const token = tokenFromHeader || tokenFromQuery

    if (token) {
      hasAccess = await hasShareTokenFileAccess(token, file.id, event)
    }
  }

  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have access to this file',
    })
  }

  const storageObject = await useFileStorage().get(file.storageKey)

  if (!storageObject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found in storage',
    })
  }

  setResponseHeaders(event, {
    'Content-Type': file.type,
    'Content-Length': file.size.toString(),
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Cookie, x-file-access-token',
  })

  return (storageObject as R2ObjectBody).body
})
