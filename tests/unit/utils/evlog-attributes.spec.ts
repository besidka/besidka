import { describe, expect, it } from 'vitest'
import { exceptionMessage, exceptionSummary } from '~~/server/utils/evlog-attributes'

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

describe('exceptionSummary', () => {
  it('keeps the error name and the code and name of the cause only', () => {
    const exception = Object.assign(
      new Error('Failed query: select ?\nparams: SECRET'),
      { name: 'DrizzleQueryError', params: ['SECRET'] },
    )

    exception.cause = Object.assign(new Error('SECRET'), {
      code: 'SQLITE_ERROR',
    })

    const summary = exceptionSummary(exception)

    expect(summary).toEqual({
      errorName: 'DrizzleQueryError',
      causeName: 'Error',
      causeCode: 'SQLITE_ERROR',
    })
    expect(JSON.stringify(summary)).not.toContain('SECRET')
  })

  it('describes a thrown non-error by its type', () => {
    expect(exceptionSummary('SECRET')).toEqual({ errorName: 'string' })
    expect(exceptionSummary(null)).toEqual({ errorName: 'object' })
  })

  it('reads a string code from the error itself', () => {
    expect(exceptionSummary(Object.assign(new Error('x'), { code: 'E_X' })))
      .toEqual({ errorName: 'Error', errorCode: 'E_X' })
  })
})
