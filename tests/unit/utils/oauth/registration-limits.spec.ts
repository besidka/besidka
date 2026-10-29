import { describe, expect, it } from 'vitest'
import {
  CLIENT_REGISTRATION_MAX_BODY_BYTES,
  findClientRegistrationViolation,
  measureBodyBytes,
} from '../../../../server/utils/oauth/registration-limits'

const validBody = {
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  contacts: ['owner@example.com'],
}

describe('findClientRegistrationViolation', () => {
  it('accepts a normal registration', () => {
    expect(findClientRegistrationViolation(validBody)).toBeNull()
  })

  it('ignores a missing body', () => {
    expect(findClientRegistrationViolation(undefined)).toBeNull()
  })

  it('rejects a declared body above 16 KiB', () => {
    expect(findClientRegistrationViolation(
      validBody,
      String(CLIENT_REGISTRATION_MAX_BODY_BYTES + 1),
    )).toContain('16 KiB')
    expect(findClientRegistrationViolation(
      validBody,
      String(CLIENT_REGISTRATION_MAX_BODY_BYTES),
    )).toBeNull()
  })

  it('measures the body itself when there is no content-length', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      jwks: 'x'.repeat(CLIENT_REGISTRATION_MAX_BODY_BYTES),
    })).toContain('16 KiB')
    expect(measureBodyBytes({ a: 1 }, null)).toBe(7)
  })

  it('rejects a client_name above 120 characters', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      client_name: 'x'.repeat(121),
    })).toContain('client_name')
    expect(findClientRegistrationViolation({
      ...validBody,
      client_name: 'x'.repeat(120),
    })).toBeNull()
  })

  it.each([
    'client_uri',
    'logo_uri',
    'tos_uri',
    'policy_uri',
    'jwks_uri',
    'backchannel_logout_uri',
  ])('rejects a %s above 2048 characters', (field) => {
    expect(findClientRegistrationViolation({
      ...validBody,
      [field]: `https://example.com/${'x'.repeat(2048)}`,
    })).toContain(field)
  })

  it('rejects more than 10 redirect_uris or a long one', () => {
    const tooMany = Array.from({ length: 11 }, (_value, index) => {
      return `https://example.com/cb/${index}`
    })

    expect(findClientRegistrationViolation({
      ...validBody,
      redirect_uris: tooMany,
    })).toContain('redirect_uris')
    expect(findClientRegistrationViolation({
      ...validBody,
      redirect_uris: [`https://example.com/${'x'.repeat(2048)}`],
    })).toContain('redirect_uris')
    expect(findClientRegistrationViolation({
      ...validBody,
      redirect_uris: tooMany.slice(0, 10),
    })).toBeNull()
  })

  it('rejects more than 10 post_logout_redirect_uris', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      post_logout_redirect_uris: Array.from({ length: 11 }, () => {
        return 'https://example.com/out'
      }),
    })).toContain('post_logout_redirect_uris')
  })

  it('rejects more than 5 contacts or a contact above 254 characters', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      contacts: Array.from({ length: 6 }, () => 'a@example.com'),
    })).toContain('contacts')
    expect(findClientRegistrationViolation({
      ...validBody,
      contacts: [`${'a'.repeat(250)}@example.com`],
    })).toContain('contacts')
  })

  it('rejects a software_statement of any shape', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      software_statement: 'a.b.c',
    })).toContain('software_statement')
    expect(findClientRegistrationViolation({
      ...validBody,
      software_statement: '',
    })).toContain('software_statement')
  })

  it('rejects software_id and software_version above 128 characters', () => {
    expect(findClientRegistrationViolation({
      ...validBody,
      software_id: 'x'.repeat(129),
    })).toContain('software_id')
    expect(findClientRegistrationViolation({
      ...validBody,
      software_version: 'x'.repeat(129),
    })).toContain('software_version')
    expect(findClientRegistrationViolation({
      ...validBody,
      software_version: 'x'.repeat(128),
    })).toBeNull()
  })

  it('leaves wrongly typed fields to the plugin validation', () => {
    expect(findClientRegistrationViolation({
      client_name: 42,
      redirect_uris: 'https://example.com',
      contacts: { length: 99 },
    })).toBeNull()
  })
})
