import { hasShareTokenFileAccess } from '~~/server/utils/files/file-share-access'
import { getPreferredFileExtension } from '#shared/utils/files'

const unsafeBidiControlPattern
  = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u

export default defineEventHandler(async (event) => {
  const { key: storageKey } = getRouterParams(event)

  if (!storageKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing file Storage Key',
    })
  }

  const file = await useDb().query.files.findFirst({
    where: {
      storageKey,
    },
    columns: {
      id: true,
      userId: true,
      storageKey: true,
      name: true,
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

  const query = getQuery(event)
  const contentDisposition = query.download === '1'
    ? buildAttachmentContentDisposition(file.name, file.type)
    : 'inline'

  setResponseHeaders(event, {
    'Content-Type': file.type,
    'Content-Length': file.size.toString(),
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Disposition': contentDisposition,
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Cookie, x-file-access-token',
  })

  return storageObject.body
})

export function buildAttachmentContentDisposition(
  fileName: string,
  mediaType: string,
): string {
  const normalizedFileName = buildDownloadFileName(fileName, mediaType)
  const asciiFileName = normalizedFileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .trim()
  const normalizedExtension = normalizedFileName
    .slice(normalizedFileName.lastIndexOf('.'))
  const fallbackFileName = asciiFileName.startsWith('.') || !asciiFileName
    ? `download${normalizedExtension}`
    : asciiFileName
  const encodedFileName = encodeURIComponent(normalizedFileName)
    .replace(/[!'()*]/g, (character) => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    })

  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`
}

export function buildDownloadFileName(
  fileName: string,
  mediaType: string,
): string {
  const extension = getPreferredFileExtension(mediaType)
  const sanitizedFileName = removeControlCharacters(fileName)
    .trim()
  const safeFileName = sanitizedFileName.split(/[/\\]/).pop() || ''
  const lastDotIndex = safeFileName.lastIndexOf('.')
  const baseName = lastDotIndex > 0
    ? safeFileName.slice(0, lastDotIndex)
    : safeFileName.replace(/^\.+/, '')
  const suffix = `.${extension}`
  const maximumBaseNameLength = 200 - suffix.length
  const normalizedBaseName = [...baseName.trim()]
    .slice(0, maximumBaseNameLength)
    .join('')
    || 'download'

  return `${normalizedBaseName}${suffix}`
}

function removeControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const codePoint = character.codePointAt(0) || 0

    return codePoint >= 0x20
      && codePoint !== 0x7f
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      && !unsafeBidiControlPattern.test(character)
  }).join('')
}
