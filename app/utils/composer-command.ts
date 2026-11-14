import type { SkillMode } from '#shared/utils/skills/mode'
import { advanceFence } from '~/composables/markdown-textarea'
import type { OpenFence } from '~/composables/markdown-textarea'

export interface ComposerCommand {
  skillId: string
  command: string
  name: string
  description: string
  version: number
  mode: SkillMode
}

export interface CommandTrigger {
  start: number
  query: string
}

export interface CommandToken {
  start: number
  end: number
  command: string
}

interface TextRange {
  start: number
  end: number
}

const QUERY_PATTERN = /^[a-z0-9-]*$/
const TOKEN_PATTERN = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g
const WHITESPACE_PATTERN = /\s/
const HORIZONTAL_WHITESPACE_PATTERN = /^[ \t]+/

/**
 * The ranges of text a command must never be read from: lines inside a
 * fenced code block (fence lines included) and inline code spans on the other
 * lines. An unclosed fence or backtick runs to the end, the way the caret
 * guard in the composer treats an open fence.
 */
export function findCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let openFence: OpenFence | null = null
  let lineStart = 0

  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length
    const wasInFence = openFence !== null

    openFence = advanceFence(openFence, line)

    if (wasInFence || openFence !== null) {
      ranges.push({ start: lineStart, end: lineEnd })
    } else {
      ranges.push(...findInlineCodeRanges(line, lineStart))
    }

    lineStart = lineEnd + 1
  }

  return ranges
}

function findInlineCodeRanges(line: string, offset: number): TextRange[] {
  const ranges: TextRange[] = []
  let openAt = -1

  for (let index = 0; index < line.length; index++) {
    if (line[index] !== '`') {
      continue
    }

    if (openAt === -1) {
      openAt = index
    } else {
      ranges.push({ start: offset + openAt, end: offset + index + 1 })
      openAt = -1
    }
  }

  if (openAt !== -1) {
    ranges.push({ start: offset + openAt, end: offset + line.length })
  }

  return ranges
}

function isInsideRanges(position: number, ranges: TextRange[]): boolean {
  return ranges.some((range) => {
    return position >= range.start && position < range.end
  })
}

/**
 * The `/` the user is typing a command after: at the start of the text or
 * right after whitespace, the caret right after the typed letters, digits
 * and hyphens, the next character blank or the end, and not inside a code
 * span or fence. A `/` after a letter (a URL, `and/or`) or after another
 * `/` never counts, and a `/` typed inside the name (`/usr/bin`) ends it.
 */
export function findCommandTrigger(
  text: string,
  caret: number,
): CommandTrigger | null {
  if (caret < 1 || caret > text.length) {
    return null
  }

  const nextCharacter = text[caret]

  if (nextCharacter !== undefined && !WHITESPACE_PATTERN.test(nextCharacter)) {
    return null
  }

  let start = caret - 1

  while (start >= 0 && text[start] !== '/') {
    if (WHITESPACE_PATTERN.test(text[start]!)) {
      return null
    }

    start -= 1
  }

  if (start < 0) {
    return null
  }

  const query = text.slice(start + 1, caret)
  const previousCharacter = start === 0 ? null : text[start - 1]!

  if (
    !QUERY_PATTERN.test(query)
    || (previousCharacter !== null
      && !WHITESPACE_PATTERN.test(previousCharacter))
  ) {
    return null
  }

  if (isInsideRanges(start, findCodeRanges(text))) {
    return null
  }

  return { start, query }
}

/**
 * The first `/name` in the text that is exactly an enabled command (followed
 * by whitespace or the end) and sits outside code. The first one wins: a
 * message carries one skill invocation, and later tokens stay plain text.
 */
export function findCommandToken(
  text: string,
  commands: ReadonlySet<string>,
): CommandToken | null {
  if (commands.size === 0 || !text.includes('/')) {
    return null
  }

  const codeRanges = findCodeRanges(text)

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const command = match[2]!
    const start = match.index + match[1]!.length

    if (commands.has(command) && !isInsideRanges(start, codeRanges)) {
      return { start, end: start + 1 + command.length, command }
    }
  }

  return null
}

/**
 * The text a send carries once its command token is taken out: the token and
 * the blank run after it go, so the rest reads as the arguments. A token in
 * the middle leaves one separator behind.
 */
export function stripCommandToken(text: string, token: CommandToken): string {
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  const keepsSeparator = before.length > 0 && !/\s$/.test(before)
  const remainder = after.replace(HORIZONTAL_WHITESPACE_PATTERN, '')

  return `${before}${keepsSeparator ? ' ' : ''}${remainder}`.trim()
}

export function filterComposerCommands(
  commands: readonly ComposerCommand[],
  query: string,
): ComposerCommand[] {
  const term = query.toLowerCase()

  if (!term) {
    return [...commands]
  }

  const matches = commands.filter((candidate) => {
    return candidate.command.includes(term)
      || candidate.name.toLowerCase().includes(term)
  })

  return matches.sort((first, second) => {
    const firstRank = first.command.startsWith(term) ? 0 : 1
    const secondRank = second.command.startsWith(term) ? 0 : 1

    return firstRank - secondRank
      || first.command.localeCompare(second.command)
  })
}

export function shouldBackspaceDeleteToken(
  token: CommandToken | null,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  return token !== null
    && selectionStart === selectionEnd
    && selectionStart === token.end
}
