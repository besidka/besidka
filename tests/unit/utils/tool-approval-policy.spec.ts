import { describe, expect, it } from 'vitest'
import { CONNECTOR_RESULT_MAX_BYTES } from '#shared/utils/connectors-policy'
import {
  TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS,
  TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES,
  TOOL_APPROVAL_CLAIM_LEASE_SECONDS,
  TOOL_APPROVAL_DENIAL_REASONS,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
  TOOL_APPROVAL_READ_SOURCES_MAX,
  TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH,
  TOOL_APPROVAL_READ_SOURCE_OVERFLOW,
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

  it('caps a stored payload like a connector result', () => {
    expect(TOOL_APPROVAL_PAYLOAD_MAX_BYTES).toBe(CONNECTOR_RESULT_MAX_BYTES)
  })

  it('bounds the per-chat index', () => {
    expect(TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS).toBeGreaterThan(0)
    expect(TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES).toBeGreaterThan(0)
  })

  it('records invalid input as a denial reason', () => {
    expect(TOOL_APPROVAL_DENIAL_REASONS).toContain('invalid-input')
  })

  it('keeps the overflow sentinel a valid, distinct read source', () => {
    expect(TOOL_APPROVAL_READ_SOURCE_OVERFLOW.length).toBeGreaterThan(0)
    expect(TOOL_APPROVAL_READ_SOURCE_OVERFLOW.length)
      .toBeLessThanOrEqual(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH)
    expect(TOOL_APPROVAL_READ_SOURCES_MAX).toBeGreaterThan(1)
  })
})
