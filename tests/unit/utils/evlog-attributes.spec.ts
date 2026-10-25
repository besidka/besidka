import { describe, expect, it } from 'vitest'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

describe('exceptionMessage', () => {
  it('returns the message of an Error', () => {
    expect(exceptionMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies values that are not Errors', () => {
    expect(exceptionMessage('plain failure')).toBe('plain failure')
    expect(exceptionMessage(42)).toBe('42')
    expect(exceptionMessage(null)).toBe('null')
    expect(exceptionMessage(undefined)).toBe('undefined')
  })

  it('keeps a multi-line message that has no bound parameters', () => {
    expect(exceptionMessage(new Error('first\nsecond'))).toBe('first\nsecond')
  })

  it('cuts a Drizzle query error at the bound parameters', () => {
    const exception = new Error(
      'Failed query: insert into "project_knowledge_items" ("title")'
      + ' values (?)\nparams: Secret customer plan,docs/private.md',
    )

    expect(exceptionMessage(exception)).toBe(
      'Failed query: insert into "project_knowledge_items" ("title")'
      + ' values (?)',
    )
  })

  it('never lets a bound parameter through', () => {
    const exception = new Error('Failed query: select 1\nparams: hunter2')

    expect(exceptionMessage(exception)).not.toContain('hunter2')
    expect(exceptionMessage(exception)).not.toContain('params')
  })

  it('cuts at the first params line only', () => {
    const exception = new Error('q\nparams: a\nparams: b')

    expect(exceptionMessage(exception)).toBe('q')
  })

  it('does not cut a message that merely mentions params', () => {
    expect(exceptionMessage(new Error('bad params: none'))).toBe(
      'bad params: none',
    )
  })

  it('cuts a stringified non-Error value the same way', () => {
    expect(exceptionMessage('Failed query: x\nparams: secret')).toBe(
      'Failed query: x',
    )
  })

  it('does not include the cause message', () => {
    const exception = new Error('outer', {
      cause: new Error('inner\nparams: secret'),
    })

    expect(exceptionMessage(exception)).toBe('outer')
  })

  it('cuts a custom error object stringified through toString', () => {
    const exception = {
      toString: () => 'Failed query: y\nparams: private title',
    }

    expect(exceptionMessage(exception)).toBe('Failed query: y')
  })
})
