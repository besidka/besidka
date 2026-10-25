import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import {
  CHAT_EXCERPT_CLOSE_TAG,
  CHAT_EXCERPT_OPEN_TAG,
  SEARCH_CHATS_TITLE_MAX_LENGTH,
  SEARCH_CHATS_UNTITLED_CHAT,
} from '~~/server/utils/memory/tools/constants'

const SENTINEL_CHARACTERS = new RegExp(`[${SNIPPET_START}${SNIPPET_END}]`, 'g')
const WHITESPACE_RUN = /\s+/g
const OPENING_ANGLE_BRACKETS = /[<\uFF1C\u3008\u27E8]/g
const CLOSING_ANGLE_BRACKETS = /[>\uFF1E\u3009\u27E9]/g
const HIGH_SURROGATE_MIN = 0xD800
const HIGH_SURROGATE_MAX = 0xDBFF

/**
 * Removes the FTS5 highlight sentinels and swaps angle brackets, including
 * the fullwidth and CJK look-alikes, for guillemets, so quoted chat text can
 * neither fake a highlight boundary nor close the surrounding
 * `<chat_excerpt>` wrapper early.
 */
export function neutralizeChatText(value: string): string {
  return value
    .replace(SENTINEL_CHARACTERS, '')
    .replace(OPENING_ANGLE_BRACKETS, '‹')
    .replace(CLOSING_ANGLE_BRACKETS, '›')
}

/**
 * Cuts to at most `maxLength` UTF-16 units without leaving half of a
 * surrogate pair at the end of the result.
 */
export function truncateText(value: string, maxLength: number): string {
  const sliced = value.slice(0, maxLength)
  const lastCodeUnit = sliced.charCodeAt(sliced.length - 1)

  if (
    lastCodeUnit >= HIGH_SURROGATE_MIN
    && lastCodeUnit <= HIGH_SURROGATE_MAX
  ) {
    return sliced.slice(0, -1)
  }

  return sliced
}

export function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim()
}

export function wrapChatExcerpt(value: string): string {
  return `${CHAT_EXCERPT_OPEN_TAG}${value}${CHAT_EXCERPT_CLOSE_TAG}`
}

export function buildSnippetExcerpt(snippet: string): string {
  return wrapChatExcerpt(collapseWhitespace(neutralizeChatText(snippet)))
}

export function buildChatTitle(title: string | null): string {
  const cleanTitle = truncateText(
    collapseWhitespace(neutralizeChatText(title ?? '')),
    SEARCH_CHATS_TITLE_MAX_LENGTH,
  ).trim()

  return cleanTitle || SEARCH_CHATS_UNTITLED_CHAT
}
