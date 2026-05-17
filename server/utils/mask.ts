/**
 * Mask an email for safe logging:
 *   john.doe@example.com -> j***.d**@e***.com
 *
 * Use in any code path that puts a user email on a logger / wide event.
 * Auto-redaction (`redact: true` in nuxt.config) covers raw email patterns,
 * but explicit masking is preferred when we deliberately set an email field.
 */
export function maskEmail(email: string | undefined | null): string {
  if (!email) {
    return '***'
  }

  const [local, domain] = email.split('@')

  if (!local || !domain) {
    return '***'
  }

  const [domainName, tld] = domain.split('.')

  if (!domainName || !tld) {
    return `${local[0]}***@***`
  }

  return `${local[0]}***@${domainName[0]}***.${tld}`
}
