import {
  GOOGLE_DRIVE_FILE_ID_PATTERN,
  GOOGLE_DRIVE_RESOURCE_KEY_PATTERN,
} from '#shared/utils/google-drive'

export type GoogleDriveLinkKind
  = | 'document'
    | 'spreadsheet'
    | 'presentation'
    | 'file'

export interface GoogleDriveLink {
  id: string
  resourceKey?: string
  kind: GoogleDriveLinkKind
}

export interface GoogleDriveLinkMatch extends GoogleDriveLink {
  url: string
}

export const GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX = 5
export const GOOGLE_DRIVE_LINK_MAX_LENGTH = 2048
export const GOOGLE_DRIVE_LINK_TRAILING_ID_MIN_LENGTH = 28

export const GOOGLE_DRIVE_LINK_KIND_LABELS: Readonly<
  Record<GoogleDriveLinkKind, string>
> = {
  document: 'Google Doc',
  spreadsheet: 'Google Sheet',
  presentation: 'Google Slides file',
  file: 'Google Drive file',
}

const DOCS_HOST = 'docs.google.com'
const DRIVE_HOST = 'drive.google.com'
const ID_SEGMENT = '([A-Za-z0-9_-]{10,128})'
const DOCS_PATH_PATTERN = new RegExp(
  `^/(document|spreadsheets|presentation)(?:/u/\\d{1,2})?/d/${ID_SEGMENT}`
  + '(?:/|$)',
)
const DRIVE_FILE_PATH_PATTERN = new RegExp(
  `^/file(?:/u/\\d{1,2})?/d/${ID_SEGMENT}(?:/|$)`,
)
const DRIVE_OPEN_PATH = '/open'
const LINK_CANDIDATE_PATTERN
  = /https:\/\/(?:docs|drive)\.google\.com\/[^\s<>()[\]"'`]+/gi
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/

const DOCS_KINDS: Readonly<Record<string, GoogleDriveLinkKind>> = {
  document: 'document',
  spreadsheets: 'spreadsheet',
  presentation: 'presentation',
}

function readResourceKey(url: URL): string | undefined {
  const value = url.searchParams.get('resourcekey')

  return value && GOOGLE_DRIVE_RESOURCE_KEY_PATTERN.test(value)
    ? value
    : undefined
}

function withResourceKey(
  link: Pick<GoogleDriveLink, 'id' | 'kind'>,
  url: URL,
): GoogleDriveLink {
  const resourceKey = readResourceKey(url)

  return resourceKey ? { ...link, resourceKey } : { ...link }
}

/**
 * One Google link as the one Drive file it names, or null. Strict on
 * purpose: HTTPS, no credentials or port, the host exactly `docs.google.com`
 * (`/document/d/<id>`, `/spreadsheets/d/<id>`, `/presentation/d/<id>`) or
 * `drive.google.com` (`/file/d/<id>`, `/open?id=<id>`), an id of the shape
 * every Drive call checks, and an optional `resourcekey`. Folders, forms,
 * shared drive roots and every other host or path give null.
 */
export function parseGoogleDriveLink(value: string): GoogleDriveLink | null {
  if (value.length === 0 || value.length > GOOGLE_DRIVE_LINK_MAX_LENGTH) {
    return null
  }

  let url: URL

  try {
    url = new URL(value)
  } catch {
    return null
  }

  const isPlainHttps = url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.port

  if (!isPlainHttps) {
    return null
  }

  if (url.hostname === DOCS_HOST) {
    const match = url.pathname.match(DOCS_PATH_PATTERN)
    const kind = match?.[1] ? DOCS_KINDS[match[1]] : undefined

    return match?.[2] && kind
      ? withResourceKey({ id: match[2], kind }, url)
      : null
  }

  if (url.hostname !== DRIVE_HOST) {
    return null
  }

  const fileMatch = url.pathname.match(DRIVE_FILE_PATH_PATTERN)

  if (fileMatch?.[1]) {
    return withResourceKey({ id: fileMatch[1], kind: 'file' }, url)
  }

  const openIds = url.pathname === DRIVE_OPEN_PATH
    ? url.searchParams.getAll('id')
    : []
  const openId = openIds.length === 1 ? openIds[0] : null

  if (openId && GOOGLE_DRIVE_FILE_ID_PATTERN.test(openId)) {
    return withResourceKey({ id: openId, kind: 'file' }, url)
  }

  return null
}

function isCompleteCandidate(
  link: GoogleDriveLink,
  candidate: string,
  endIndex: number,
  textLength: number,
): boolean {
  const isAtEndOfText = endIndex >= textLength
  const endsRightAfterId = candidate.endsWith(link.id)

  return !(isAtEndOfText
    && endsRightAfterId
    && link.id.length < GOOGLE_DRIVE_LINK_TRAILING_ID_MIN_LENGTH)
}

const FENCED_CODE_PATTERN
  = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm
const INLINE_CODE_PATTERN = /(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g

function blankOut(match: string): string {
  return match.replace(/[^\n]/g, ' ')
}

/**
 * The text with fenced code blocks (an unclosed fence runs to the end, as in
 * Markdown) and inline code spans replaced by spaces, so a link someone
 * shows as code is never read as a link and every other position stays put.
 */
function maskCode(text: string): string {
  return text
    .replace(FENCED_CODE_PATTERN, blankOut)
    .replace(INLINE_CODE_PATTERN, blankOut)
}

/**
 * The Google file links in a piece of text, first appearance first, one per
 * file id, at most `max`. Links inside code blocks and code spans are
 * skipped. A link that ends the text right after a short id
 * is skipped: while someone is still typing, a half-written id already
 * matches the id pattern, and acting on it would probe ids that are not
 * files. Each match carries the link as written (`url`), which is what the
 * server parses again.
 */
export function extractGoogleDriveLinks(
  text: string,
  max: number = GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX,
): GoogleDriveLinkMatch[] {
  const links: GoogleDriveLinkMatch[] = []
  const seenIds = new Set<string>()

  for (const match of maskCode(text).matchAll(LINK_CANDIDATE_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION_PATTERN, '')
    const link = parseGoogleDriveLink(candidate)

    if (!link || seenIds.has(link.id)) {
      continue
    }

    const endIndex = (match.index ?? 0) + match[0].length

    if (!isCompleteCandidate(link, candidate, endIndex, text.length)) {
      continue
    }

    seenIds.add(link.id)
    links.push({ ...link, url: candidate })

    if (links.length >= max) {
      break
    }
  }

  return links
}
