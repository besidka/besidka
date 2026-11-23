import { describe, expect, it } from 'vitest'
import { readExecutionId } from '~~/server/utils/google/execution-id'

describe('readExecutionId', () => {
  it('reads the approval id of an approved call', () => {
    expect(readExecutionId({ approvalId: 'approval_one' }))
      .toBe('approval_one')
  })

  it('reads the execution id of a call that ran without asking', () => {
    expect(readExecutionId({ executionId: 'exec_one' })).toBe('exec_one')
  })

  it('prefers the approval id when both are present', () => {
    expect(readExecutionId({
      approvalId: 'approval_one',
      executionId: 'exec_one',
    })).toBe('approval_one')
  })

  it('answers null for no id, an empty id or an id that is not a string',
    () => {
      expect(readExecutionId(undefined)).toBeNull()
      expect(readExecutionId(null)).toBeNull()
      expect(readExecutionId({})).toBeNull()
      expect(readExecutionId({ approvalId: '' })).toBeNull()
      expect(readExecutionId({ executionId: '' })).toBeNull()
      expect(readExecutionId({ approvalId: 7, executionId: {} })).toBeNull()
      expect(readExecutionId({ toolCallId: 'call-1' })).toBeNull()
    })
})
