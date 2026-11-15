import { describe, expect, it } from 'vitest'
import {
  TOOL_APPROVAL_CLAIM_LEASE_SECONDS,
  TOOL_APPROVAL_CLAIM_RETENTION_HOURS,
  TOOL_APPROVAL_ID_PATTERN,
  TOOL_APPROVAL_KV_PREFIX,
  TOOL_APPROVAL_TTL_SECONDS,
} from '#shared/utils/tool-approval-policy'

describe('tool approval policy constants', () => {
  it('keeps pending approvals for 24 hours', () => {
    expect(TOOL_APPROVAL_TTL_SECONDS).toBe(24 * 60 * 60)
  })

  it('keeps claims for twice the life of the KV record', () => {
    expect(TOOL_APPROVAL_CLAIM_RETENTION_HOURS * 60 * 60)
      .toBeGreaterThan(TOOL_APPROVAL_TTL_SECONDS)
  })

  it('uses a 120 second claim lease like the generation guard', () => {
    expect(TOOL_APPROVAL_CLAIM_LEASE_SECONDS).toBe(120)
  })

  it('keeps the KV prefix out of the approval id alphabet', () => {
    expect(TOOL_APPROVAL_KV_PREFIX).toBe('tool-approval:')
    expect(TOOL_APPROVAL_ID_PATTERN.test('a:b:cdefgh')).toBe(false)
  })
})
