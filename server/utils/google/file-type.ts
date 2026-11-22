const SAFE_FILE_TYPE_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/
const GENERIC_FILE_TYPE = 'application/octet-stream'
const FILE_TYPE_MAX_LENGTH = 100

/**
 * A Drive `mimeType` is attacker-controlled text, and the type next to a
 * file sits outside the untrusted frame. Only a plain lowercase
 * `type/subtype` of at most 100 characters is passed on, with any
 * parameters after `;` dropped; everything else becomes the generic type.
 */
export function safeFileType(mimeType: unknown): string {
  if (typeof mimeType !== 'string') {
    return GENERIC_FILE_TYPE
  }

  const essence = (mimeType.split(';')[0] as string).trim().toLowerCase()

  return essence.length <= FILE_TYPE_MAX_LENGTH
    && SAFE_FILE_TYPE_PATTERN.test(essence)
    ? essence
    : GENERIC_FILE_TYPE
}
