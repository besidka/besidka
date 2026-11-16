const CODE_HOSTING_DOMAINS: Readonly<Record<string, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
}
const LABEL_PATTERN = /^[a-z0-9-]{1,40}$/i
const MAX_PUBLISHER_LENGTH = 100

/**
 * The publisher a directory card shows, read from the registry name
 * namespace as a full domain, so two publishers never share a label:
 * `app.linear/linear` is `linear.app`, `xyz.linear/x` is `linear.xyz`,
 * `com.google.maps/server` is `maps.google.com` and `io.github.acme/tool` is
 * `github.com/acme`. The registry only accepts a namespace its publisher
 * proved they own, but Besidka does not review entries, so this is a label
 * and never a trust mark. Null when the name has no usable namespace.
 */
export function deriveConnectorPublisher(registryName: string): string | null {
  const namespace = registryName.split('/')[0] ?? ''
  const labels = namespace.split('.')

  if (labels.length < 2 || !labels.every(label => LABEL_PATTERN.test(label))) {
    return null
  }

  const [, second = '', ...rest] = labels
  const hostingDomain = CODE_HOSTING_DOMAINS[second.toLowerCase()]
  const [owner] = rest
  const publisher = hostingDomain && owner && rest.length === 1
    ? `${hostingDomain}/${owner}`
    : [...labels].reverse().join('.')

  return publisher.length <= MAX_PUBLISHER_LENGTH
    ? publisher.toLowerCase()
    : null
}
