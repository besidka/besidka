import { describe, expect, it } from 'vitest'
import { readSendPathTurns } from '~~/server/utils/jev/send-path'

const COMMAND_USER = {
  role: 'user',
  parts: [
    { type: 'data-command-invocation', data: { command: 'stats' } },
    { type: 'text', text: '7d' },
  ],
}

const COMMAND_REPORT = {
  role: 'assistant',
  parts: [
    { type: 'data-command-report', data: { command: 'stats' } },
    { type: 'text', text: '```text\nSECRET REPORT\n```' },
  ],
}

describe('readSendPathTurns', () => {
  it('returns the last turns that carry text, oldest first', () => {
    expect(readSendPathTurns([
      { role: 'user', parts: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'two' }] },
      { role: 'user', parts: [{ type: 'text', text: 'three' }] },
    ], 2)).toEqual([
      { role: 'assistant', text: 'two' },
      { role: 'user', text: 'three' },
    ])
  })

  it('never hands the messages of a built-in command to Jev', () => {
    const turns = readSendPathTurns([
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      COMMAND_USER,
      COMMAND_REPORT,
      { role: 'assistant', parts: [{ type: 'text', text: 'answer' }] },
    ], 10)

    expect(turns).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'answer' },
    ])
    expect(JSON.stringify(turns)).not.toContain('SECRET REPORT')
  })

  it('returns nothing for a limit of zero', () => {
    expect(readSendPathTurns([COMMAND_USER], 0)).toEqual([])
  })
})
