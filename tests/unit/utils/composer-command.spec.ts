import { describe, expect, it } from 'vitest'
import {
  filterComposerCommands,
  findCodeRanges,
  findCommandToken,
  findCommandTrigger,
  shouldBackspaceDeleteToken,
  stripCommandToken,
} from '../../../app/utils/composer-command'
import type {
  CommandToken,
  ComposerCommand,
} from '../../../app/utils/composer-command'

const COMMANDS: ReadonlySet<string> = new Set(['meeting-notes', 'c'])

function createCommand(
  command: string,
  name: string,
): ComposerCommand {
  return {
    skillId: `skl-${command}`,
    command,
    name,
    description: `${name} description`,
    version: 1,
    mode: 'ask',
  }
}

function triggerAtEnd(text: string) {
  return findCommandTrigger(text, text.length)
}

describe('findCommandTrigger', () => {
  it('opens on a slash at the start of the text with an empty query', () => {
    expect(triggerAtEnd('/')).toEqual({ start: 0, query: '' })
  })

  it('opens after a space', () => {
    expect(triggerAtEnd('hello /')).toEqual({ start: 6, query: '' })
  })

  it('opens after a newline', () => {
    expect(triggerAtEnd('first line\n/')).toEqual({ start: 11, query: '' })
  })

  it('grows the query with the typed letters, digits and hyphens', () => {
    expect(triggerAtEnd('/m')).toEqual({ start: 0, query: 'm' })
    expect(triggerAtEnd('/mee')).toEqual({ start: 0, query: 'mee' })
    expect(triggerAtEnd('/meeting-notes2')).toEqual({
      start: 0,
      query: 'meeting-notes2',
    })
    expect(triggerAtEnd('Please run /mee')).toEqual({
      start: 11,
      query: 'mee',
    })
  })

  it('needs the caret right after the typed characters', () => {
    expect(findCommandTrigger('/mee', 2)).toBeNull()
    expect(findCommandTrigger('/mee more', 4)).toEqual({
      start: 0,
      query: 'mee',
    })
    expect(findCommandTrigger('/mee more', 7)).toBeNull()
  })

  it('does not open when the slash follows a non-whitespace character', () => {
    expect(triggerAtEnd('and/or')).toBeNull()
    expect(triggerAtEnd('a/b')).toBeNull()
    expect(triggerAtEnd('https://x.com')).toBeNull()
    expect(findCommandTrigger('https://x.com', 8)).toBeNull()
    expect(findCommandTrigger('https://x.com', 7)).toBeNull()
  })

  it('does not open for a double slash', () => {
    expect(triggerAtEnd('//')).toBeNull()
    expect(triggerAtEnd('hello //')).toBeNull()
  })

  it('stops once a second slash makes the word a path', () => {
    expect(triggerAtEnd('/usr/bin')).toBeNull()
    expect(triggerAtEnd('/usr/')).toBeNull()
    expect(triggerAtEnd('/usr')).toEqual({ start: 0, query: 'usr' })
  })

  it('does not open when text follows the caret without a blank', () => {
    expect(findCommandTrigger('/meeting', 4)).toBeNull()
  })

  it('opens when a blank or line break follows the caret', () => {
    expect(findCommandTrigger('/me ting', 3)).toEqual({
      start: 0,
      query: 'me',
    })
    expect(findCommandTrigger('/me\nting', 3)).toEqual({
      start: 0,
      query: 'me',
    })
  })

  it('does not open for uppercase letters or other characters', () => {
    expect(triggerAtEnd('/Me')).toBeNull()
    expect(triggerAtEnd('/me_x')).toBeNull()
    expect(triggerAtEnd('/me.x')).toBeNull()
  })

  it('does not open inside an open fenced block', () => {
    expect(triggerAtEnd('```\n/x')).toBeNull()
    expect(triggerAtEnd('```ts\nconst a = 1\n/')).toBeNull()
    expect(triggerAtEnd('~~~\n/x')).toBeNull()
  })

  it('opens again after a fenced block is closed', () => {
    expect(triggerAtEnd('```\ncode\n```\n/x')).toEqual({
      start: 13,
      query: 'x',
    })
  })

  it('does not open inside an inline code span', () => {
    expect(triggerAtEnd('`/x')).toBeNull()
    expect(triggerAtEnd('say `a /x')).toBeNull()
    expect(findCommandTrigger('`a /x b`', 5)).toBeNull()
  })

  it('opens after an inline code span has closed', () => {
    expect(triggerAtEnd('`a` /x')).toEqual({ start: 4, query: 'x' })
  })

  it('does not open for a caret at 0 or beyond the text', () => {
    expect(findCommandTrigger('/x', 0)).toBeNull()
    expect(findCommandTrigger('/x', 3)).toBeNull()
    expect(findCommandTrigger('', 0)).toBeNull()
  })

  it('does not open for plain text without a slash', () => {
    expect(triggerAtEnd('hello')).toBeNull()
    expect(triggerAtEnd('hello ')).toBeNull()
  })
})

describe('findCodeRanges', () => {
  it('returns the fence lines and inline spans', () => {
    const text = ['a `b` c', '```', 'x', '```', 'd'].join('\n')

    expect(findCodeRanges(text)).toEqual([
      { start: 2, end: 5 },
      { start: 8, end: 11 },
      { start: 12, end: 13 },
      { start: 14, end: 17 },
    ])
  })

  it('runs an unclosed fence or backtick to the end', () => {
    expect(findCodeRanges('```\nabc')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ])
    expect(findCodeRanges('a `b')).toEqual([{ start: 2, end: 4 }])
  })

  it('returns nothing for plain text', () => {
    expect(findCodeRanges('plain\ntext')).toEqual([])
  })
})

describe('findCommandToken', () => {
  it('matches an exact command at the start followed by a blank', () => {
    expect(findCommandToken('/c rest', COMMANDS)).toEqual({
      start: 0,
      end: 2,
      command: 'c',
    })
  })

  it('matches an exact command at the end of the text', () => {
    expect(findCommandToken('/c', COMMANDS)).toEqual({
      start: 0,
      end: 2,
      command: 'c',
    })
    expect(findCommandToken('Please /meeting-notes', COMMANDS)).toEqual({
      start: 7,
      end: 21,
      command: 'meeting-notes',
    })
  })

  it('matches in the middle of a line', () => {
    expect(findCommandToken('Please /c this', COMMANDS)).toEqual({
      start: 7,
      end: 9,
      command: 'c',
    })
  })

  it('matches after a newline', () => {
    expect(findCommandToken('first\n/c now', COMMANDS)).toEqual({
      start: 6,
      end: 8,
      command: 'c',
    })
  })

  it('does not match a longer name that only starts like a command', () => {
    expect(findCommandToken('/meeting-notes-x', COMMANDS)).toBeNull()
    expect(findCommandToken('/cc rest', COMMANDS)).toBeNull()
  })

  it('does not match a prefix of a command', () => {
    expect(findCommandToken('/mee', COMMANDS)).toBeNull()
    expect(findCommandToken('/meeting', COMMANDS)).toBeNull()
  })

  it('does not match a command that is not enabled', () => {
    expect(findCommandToken('/other rest', COMMANDS)).toBeNull()
  })

  it('does not match a slash glued to other text', () => {
    expect(findCommandToken('http://a/meeting-notes', COMMANDS)).toBeNull()
    expect(findCommandToken('and/c', COMMANDS)).toBeNull()
    expect(findCommandToken('//c', COMMANDS)).toBeNull()
  })

  it('does not match inside a fenced block', () => {
    expect(findCommandToken('```\n/c\n```', COMMANDS)).toBeNull()
    expect(findCommandToken('```\n/c', COMMANDS)).toBeNull()
  })

  it('does not match inside an inline code span', () => {
    expect(findCommandToken('x `a /c b` y', COMMANDS)).toBeNull()
    expect(findCommandToken('x `a /c', COMMANDS)).toBeNull()
  })

  it('reads a token that follows a closed code span', () => {
    const text = '`x /c` /c'

    expect(findCommandToken(text, COMMANDS)).toEqual({
      start: 7,
      end: 9,
      command: 'c',
    })
  })

  it('picks the first matching token when two match', () => {
    expect(findCommandToken('/c and /meeting-notes', COMMANDS)).toEqual({
      start: 0,
      end: 2,
      command: 'c',
    })
    expect(findCommandToken('/meeting-notes /c', COMMANDS)).toEqual({
      start: 0,
      end: 14,
      command: 'meeting-notes',
    })
  })

  it('skips a non-command slash word before a command', () => {
    expect(findCommandToken('/nope /c', COMMANDS)).toEqual({
      start: 6,
      end: 8,
      command: 'c',
    })
  })

  it('returns null without commands or without a slash', () => {
    expect(findCommandToken('/c rest', new Set())).toBeNull()
    expect(findCommandToken('no slash here', COMMANDS)).toBeNull()
    expect(findCommandToken('', COMMANDS)).toBeNull()
  })
})

describe('stripCommandToken', () => {
  function tokenOf(text: string): CommandToken {
    const token = findCommandToken(text, COMMANDS)

    if (!token) {
      throw new Error(`No token in ${JSON.stringify(text)}`)
    }

    return token
  }

  it('strips a token at the start', () => {
    expect(stripCommandToken('/c rest', tokenOf('/c rest'))).toBe('rest')
  })

  it('strips a token in the middle and leaves one separator', () => {
    const text = 'Please /c this'

    expect(stripCommandToken(text, tokenOf(text))).toBe('Please this')
  })

  it('strips a token at the end', () => {
    const text = 'Please /c'

    expect(stripCommandToken(text, tokenOf(text))).toBe('Please')
  })

  it('returns an empty string when the token is the whole text', () => {
    expect(stripCommandToken('/c', tokenOf('/c'))).toBe('')
    expect(stripCommandToken('/c  ', tokenOf('/c  '))).toBe('')
  })

  it('drops every space and tab after the token', () => {
    const text = '/c   \t rest'

    expect(stripCommandToken(text, tokenOf(text))).toBe('rest')
  })

  it('keeps the line break after the token and the text beyond it', () => {
    const text = 'a /c\nb'

    expect(stripCommandToken(text, tokenOf(text))).toBe('a \nb')
  })

  it('trims a leading line break when the token opens the text', () => {
    const text = '/c\nsecond line'

    expect(stripCommandToken(text, tokenOf(text))).toBe('second line')
  })

  it('keeps the rest of a multi-line message intact', () => {
    const text = 'intro\n/c do it\nline two'

    expect(stripCommandToken(text, tokenOf(text))).toBe(
      'intro\ndo it\nline two',
    )
  })

  it('adds a separator when the token is glued to the text before it', () => {
    const token: CommandToken = { start: 1, end: 3, command: 'c' }

    expect(stripCommandToken('a/c b', token)).toBe('a b')
  })
})

describe('filterComposerCommands', () => {
  const commands = [
    createCommand('meeting-notes', 'Meeting Notes'),
    createCommand('notes-to-email', 'Email'),
    createCommand('summarize', 'Notes digest'),
  ]

  it('returns every command for an empty query, as a copy', () => {
    const result = filterComposerCommands(commands, '')

    expect(result).toEqual(commands)
    expect(result).not.toBe(commands)
  })

  it('ranks a command prefix before a contains match', () => {
    const result = filterComposerCommands(commands, 'notes')

    expect(result.map((command) => {
      return command.command
    })).toEqual(['notes-to-email', 'meeting-notes', 'summarize'])
  })

  it('matches on the display name', () => {
    const result = filterComposerCommands(commands, 'digest')

    expect(result.map((command) => {
      return command.command
    })).toEqual(['summarize'])
  })

  it('matches the command anywhere in it', () => {
    const result = filterComposerCommands(commands, 'ting')

    expect(result.map((command) => {
      return command.command
    })).toEqual(['meeting-notes'])
  })

  it('ignores the case of the query', () => {
    expect(filterComposerCommands(commands, 'NOTES')).toEqual(
      filterComposerCommands(commands, 'notes'),
    )
    expect(filterComposerCommands(commands, 'EMAIL')).toHaveLength(1)
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterComposerCommands(commands, 'zzz')).toEqual([])
  })

  it('does not reorder the input list', () => {
    const input = [...commands]

    filterComposerCommands(input, 'notes')

    expect(input).toEqual(commands)
  })
})

describe('shouldBackspaceDeleteToken', () => {
  const token: CommandToken = { start: 2, end: 10, command: 'meeting' }

  it('is true for a collapsed selection exactly at the token end', () => {
    expect(shouldBackspaceDeleteToken(token, 10, 10)).toBe(true)
  })

  it('is false without a token', () => {
    expect(shouldBackspaceDeleteToken(null, 10, 10)).toBe(false)
  })

  it('is false for a range selection', () => {
    expect(shouldBackspaceDeleteToken(token, 8, 10)).toBe(false)
    expect(shouldBackspaceDeleteToken(token, 10, 12)).toBe(false)
  })

  it('is false when the caret is anywhere else', () => {
    expect(shouldBackspaceDeleteToken(token, 9, 9)).toBe(false)
    expect(shouldBackspaceDeleteToken(token, 11, 11)).toBe(false)
    expect(shouldBackspaceDeleteToken(token, 2, 2)).toBe(false)
  })
})
