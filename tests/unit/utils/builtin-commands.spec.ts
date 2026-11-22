import { describe, expect, it } from 'vitest'
import {
  BUILTIN_COMMANDS,
  BUILTIN_COMMAND_NAMES,
  PLANNED_BUILTIN_COMMAND_NAMES,
  filterBuiltinCommands,
  findBuiltinCommandInvocation,
  formatBuiltinCommandReply,
  getBuiltinCommand,
  isBuiltinCommandAllowed,
  isBuiltinCommandMessage,
  isBuiltinCommandReportPart,
  isDataBuiltinCommandPart,
  toBuiltinCommandPart,
  toBuiltinCommandReportPart,
} from '#shared/utils/builtin-commands'
import { SKILL_NAME_PATTERN } from '#shared/utils/skills-policy'

describe('built-in command registry', () => {
  it('registers /cost, /debug and /stats with their Besidka tools', () => {
    expect(BUILTIN_COMMANDS.map((command) => {
      return [command.name, command.besidkaTool]
    })).toEqual([
      ['cost', 'get_chat_cost'],
      ['debug', 'get_debug_info'],
      ['stats', 'get_usage_stats'],
    ])
  })

  it('needs only the commands flag, since no model is called', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(command.requiredFeatures).toEqual(['skills.commands'])
    }
  })

  it('uses names a skill command could otherwise take', () => {
    for (const name of [
      ...BUILTIN_COMMAND_NAMES,
      ...PLANNED_BUILTIN_COMMAND_NAMES,
    ]) {
      expect(SKILL_NAME_PATTERN.test(name), name).toBe(true)
    }
  })

  it('keeps the planned names apart from the built-in names', () => {
    expect(PLANNED_BUILTIN_COMMAND_NAMES).toContain('usage')

    for (const name of BUILTIN_COMMAND_NAMES) {
      expect(PLANNED_BUILTIN_COMMAND_NAMES).not.toContain(name)
    }
  })

  it('gives every command a plain-words example for the Skills page', () => {
    for (const command of BUILTIN_COMMANDS) {
      expect(command.example.length, command.name).toBeGreaterThan(10)
    }
  })

  it('filters by name, a leading slash, title or description', () => {
    const names = (query: string) => {
      return filterBuiltinCommands(BUILTIN_COMMANDS, query).map((command) => {
        return command.name
      })
    }

    expect(names('')).toEqual(['cost', 'debug', 'stats'])
    expect(names('/deb')).toEqual(['debug'])
    expect(names('USAGE')).toEqual(['stats'])
    expect(names('support')).toEqual(['debug'])
    expect(names('zzz')).toEqual([])
  })

  it('finds a command by name', () => {
    expect(getBuiltinCommand('stats').argumentHint).toBe('[7d|30d|all]')
  })

  it('allows a command only when every feature it needs is active', () => {
    const command = getBuiltinCommand('cost')

    expect(isBuiltinCommandAllowed(command, () => true)).toBe(true)
    expect(isBuiltinCommandAllowed(command, () => false)).toBe(false)
  })
})

describe('built-in command parts', () => {
  it('builds and recognizes the invocation part', () => {
    const part = toBuiltinCommandPart('debug')

    expect(part).toEqual({
      type: 'data-command-invocation',
      data: { command: 'debug' },
    })
    expect(isDataBuiltinCommandPart(part)).toBe(true)
    expect(findBuiltinCommandInvocation([{ type: 'text' }, part]))
      .toEqual({ command: 'debug' })
  })

  it('refuses a part with an unknown command', () => {
    expect(isDataBuiltinCommandPart({
      type: 'data-command-invocation',
      data: { command: 'rm' },
    })).toBe(false)
    expect(findBuiltinCommandInvocation(undefined)).toBeNull()
  })

  it('marks the messages of a command, the request and the report', () => {
    const report = toBuiltinCommandReportPart('cost')

    expect(isBuiltinCommandReportPart(report)).toBe(true)
    expect(isBuiltinCommandMessage({ parts: [report] })).toBe(true)
    expect(isBuiltinCommandMessage({
      parts: [toBuiltinCommandPart('cost')],
    })).toBe(true)
    expect(isBuiltinCommandMessage({ parts: [{ type: 'text' }] }))
      .toBe(false)
    expect(isBuiltinCommandMessage({})).toBe(false)
  })

  it('wraps a report in one fenced text block', () => {
    expect(formatBuiltinCommandReply('line 1\nline 2\n\n'))
      .toBe('```text\nline 1\nline 2\n```')
  })

  it('uses a fence longer than any backtick run in the report', () => {
    expect(formatBuiltinCommandReply('a\n```\nb'))
      .toBe('````text\na\n```\nb\n````')
    expect(formatBuiltinCommandReply('``````'))
      .toBe('```````text\n``````\n```````')
    expect(formatBuiltinCommandReply('one ` and `` two'))
      .toBe('```text\none ` and `` two\n```')
  })
})
