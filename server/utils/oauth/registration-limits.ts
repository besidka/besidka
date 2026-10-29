export const CLIENT_REGISTRATION_MAX_BODY_BYTES = 16 * 1024
export const CLIENT_REGISTRATION_MAX_CLIENT_NAME_LENGTH = 120
export const CLIENT_REGISTRATION_MAX_URI_LENGTH = 2048
export const CLIENT_REGISTRATION_MAX_REDIRECT_URIS = 10
export const CLIENT_REGISTRATION_MAX_POST_LOGOUT_REDIRECT_URIS = 10
export const CLIENT_REGISTRATION_MAX_CONTACTS = 5
export const CLIENT_REGISTRATION_MAX_CONTACT_LENGTH = 254
export const CLIENT_REGISTRATION_MAX_SOFTWARE_FIELD_LENGTH = 128

const URI_FIELDS = [
  'client_uri',
  'logo_uri',
  'tos_uri',
  'policy_uri',
  'jwks_uri',
  'backchannel_logout_uri',
] as const

const SOFTWARE_FIELDS = ['software_id', 'software_version'] as const

function exceedsLength(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length > maxLength
}

function exceedsListLimits(
  value: unknown,
  maxEntries: number,
  maxEntryLength: number,
): boolean {
  if (!Array.isArray(value)) {
    return false
  }

  return value.length > maxEntries
    || value.some((entry) => {
      return exceedsLength(entry, maxEntryLength)
    })
}

export function measureBodyBytes(
  body: Record<string, unknown> | undefined,
  contentLengthHeader: string | null | undefined,
): number {
  const declaredLength = Number(contentLengthHeader)

  if (contentLengthHeader && Number.isFinite(declaredLength)) {
    return declaredLength
  }

  return new TextEncoder().encode(JSON.stringify(body ?? {})).byteLength
}

/**
 * Returns the first dynamic client registration limit the body breaks, or
 * `null` when it fits. Registration is unauthenticated, so every field that
 * is stored or shown on the consent page is bounded here, before the plugin
 * validates the body. The body is untrusted and not yet schema-checked, so
 * every field is type-guarded.
 */
export function findClientRegistrationViolation(
  body: Record<string, unknown> | undefined,
  contentLengthHeader?: string | null,
): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  if (
    measureBodyBytes(body, contentLengthHeader)
    > CLIENT_REGISTRATION_MAX_BODY_BYTES
  ) {
    return 'The registration request is larger than 16 KiB'
  }

  if (body.software_statement !== undefined) {
    return 'software_statement is not supported'
  }

  if (exceedsLength(
    body.client_name,
    CLIENT_REGISTRATION_MAX_CLIENT_NAME_LENGTH,
  )) {
    return 'client_name is longer than 120 characters'
  }

  for (const field of URI_FIELDS) {
    if (exceedsLength(body[field], CLIENT_REGISTRATION_MAX_URI_LENGTH)) {
      return `${field} is longer than 2048 characters`
    }
  }

  if (exceedsListLimits(
    body.redirect_uris,
    CLIENT_REGISTRATION_MAX_REDIRECT_URIS,
    CLIENT_REGISTRATION_MAX_URI_LENGTH,
  )) {
    return 'redirect_uris has more than 10 entries or an entry longer '
      + 'than 2048 characters'
  }

  if (exceedsListLimits(
    body.post_logout_redirect_uris,
    CLIENT_REGISTRATION_MAX_POST_LOGOUT_REDIRECT_URIS,
    CLIENT_REGISTRATION_MAX_URI_LENGTH,
  )) {
    return 'post_logout_redirect_uris has more than 10 entries or an entry '
      + 'longer than 2048 characters'
  }

  if (exceedsListLimits(
    body.contacts,
    CLIENT_REGISTRATION_MAX_CONTACTS,
    CLIENT_REGISTRATION_MAX_CONTACT_LENGTH,
  )) {
    return 'contacts has more than 5 entries or an entry longer than '
      + '254 characters'
  }

  for (const field of SOFTWARE_FIELDS) {
    if (exceedsLength(
      body[field],
      CLIENT_REGISTRATION_MAX_SOFTWARE_FIELD_LENGTH,
    )) {
      return `${field} is longer than 128 characters`
    }
  }

  return null
}
