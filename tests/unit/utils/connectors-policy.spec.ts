import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ALLOWED_PORTS,
  CONNECTOR_AUDIT_RETENTION_DAYS,
  CONNECTOR_CALL_TIMEOUT_MS,
  CONNECTOR_HEADER_NAME_PATTERN,
  CONNECTOR_REJECTED_HEADER_NAMES,
  CONNECTOR_SLUG_MAX_LENGTH,
  CONNECTOR_SLUG_PATTERN,
  CONNECTOR_STATUSES,
  CONNECTORS_PER_USER,
  SAFE_FETCH_DEFAULT_MAX_BYTES,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  SAFE_FETCH_MAX_REDIRECTS,
} from '#shared/utils/connectors-policy'

describe('connectors policy', () => {
  it('matches the limits of docs/connectors.md section 9', () => {
    expect(CONNECTORS_PER_USER).toBe(20)
    expect(CONNECTOR_CALL_TIMEOUT_MS).toBe(60_000)
    expect(CONNECTOR_AUDIT_RETENTION_DAYS).toBe(90)
    expect(SAFE_FETCH_DEFAULT_TIMEOUT_MS).toBe(10_000)
    expect(SAFE_FETCH_DEFAULT_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(SAFE_FETCH_MAX_REDIRECTS).toBe(3)
    expect(CONNECTOR_ALLOWED_PORTS).toEqual([443, 8443])
  })

  it('has no disabled status, because enabled is the only switch', () => {
    expect(CONNECTOR_STATUSES).toEqual([
      'needs-auth',
      'ready',
      'drifted',
      'error',
    ])
  })

  it('accepts only slugs of 1 to 16 lowercase characters', () => {
    expect(CONNECTOR_SLUG_PATTERN.test('a'.repeat(CONNECTOR_SLUG_MAX_LENGTH)))
      .toBe(true)
    expect(CONNECTOR_SLUG_PATTERN.test('a'.repeat(CONNECTOR_SLUG_MAX_LENGTH + 1)))
      .toBe(false)
    expect(CONNECTOR_SLUG_PATTERN.test('-ab')).toBe(false)
  })

  it('validates header names and lists the rejected ones in lower case', () => {
    expect(CONNECTOR_HEADER_NAME_PATTERN.test('X-Api-Key')).toBe(true)
    expect(CONNECTOR_HEADER_NAME_PATTERN.test('X Api')).toBe(false)
    expect(CONNECTOR_HEADER_NAME_PATTERN.test('a'.repeat(65))).toBe(false)

    for (const name of CONNECTOR_REJECTED_HEADER_NAMES) {
      expect(name).toBe(name.toLowerCase())
    }

    expect(CONNECTOR_REJECTED_HEADER_NAMES).toContain('mcp-session-id')
  })
})
