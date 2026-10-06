import { createError } from 'evlog'
import { hasShareTokenFileAccess } from '~~/server/utils/files/file-share-access'
import {
  getTestImageFixtureBytes,
  TEST_IMAGE_FIXTURE_MEDIA_TYPE,
} from '~~/server/utils/chats/test/image-fixture-bytes'
import { isTestImageFixtureStorageKey } from '~~/server/utils/chats/test/image-fixture'
import { getPreferredFileExtension } from '#shared/utils/files'
import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRouterParams,
} from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const unsafeBidiControlPattern
  = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u

export default defineEventHandler(async (event) => {
  const { key: storageKey } = getRouterParams(event, { decode: true })

  if (!storageKey) {
    throw createError({
      message: 'Missing file Storage Key',
      status: 400,
    })
  }

  const isTestEnvironment = import.meta.dev || process.env.CI === 'true'

  if (isTestEnvironment && isTestImageFixtureStorageKey(storageKey)) {
    const bytes = getTestImageFixtureBytes()
    const query = getQuery(event)
    const contentDisposition = query.download === '1'
      ? buildAttachmentContentDisposition(
        'sunset-mountain.png',
        TEST_IMAGE_FIXTURE_MEDIA_TYPE,
      )
      : 'inline'

    applyResponseHeaders(event, {
      'Content-Type': TEST_IMAGE_FIXTURE_MEDIA_TYPE,
      'Content-Length': bytes.byteLength.toString(),
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': contentDisposition,
      'X-Content-Type-Options': 'nosniff',
    })

    return bytes
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
      message: 'File not found',
      status: 404,
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
      hasAccess = await hasShareTokenFileAccess(token, file.id)
    }
  }

  if (!hasAccess) {
    throw createError({
      message: 'You do not have access to this file',
      status: 403,
    })
  }

  const storageObject = await useFileStorage().get(file.storageKey)

  if (!storageObject) {
    throw createError({
      message: 'File not found in storage',
      status: 404,
    })
  }

  const query = getQuery(event)
  const contentDisposition = query.download === '1'
    ? buildAttachmentContentDisposition(file.name, file.type)
    : 'inline'

  applyResponseHeaders(event, {
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
