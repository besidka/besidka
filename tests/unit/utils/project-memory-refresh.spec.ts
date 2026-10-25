import { describe, expect, it } from 'vitest'
import { describeProjectMemoryRefreshFailure } from '../../../app/utils/project-memory-refresh'

describe('describeProjectMemoryRefreshFailure', () => {
  it('turns HTTP 429 into the friendly cooldown notice', () => {
    expect(describeProjectMemoryRefreshFailure({
      status: 429,
      message: 'Project memory was refreshed moments ago',
      why: 'A refresh already ran in the last minute.',
    })).toEqual({
      isCooldown: true,
      title: 'Memory was refreshed a moment ago',
      description: 'Try again in a minute.',
    })
  })

  it('keeps the server message and reason for other failures', () => {
    expect(describeProjectMemoryRefreshFailure({
      status: 409,
      message: 'Memory is turned off',
      why: 'Project memory needs memory to be turned on.',
    })).toEqual({
      isCooldown: false,
      title: 'Memory is turned off',
      description: 'Project memory needs memory to be turned on.',
    })
  })

  it('falls back to a generic title without a message', () => {
    expect(describeProjectMemoryRefreshFailure({ status: 500 })).toEqual({
      isCooldown: false,
      title: 'Failed to refresh project memory',
      description: undefined,
    })
  })
})
