const CODE_HOSTING_LABELS = new Set(['github', 'gitlab', 'bitbucket'])

function capitalize(value: string): string {
  const [first = '', ...rest] = Array.from(value)

  return first.toLocaleUpperCase() + rest.join('')
}

/**
 * The publisher a directory card shows, read from the registry name
 * namespace (`app.linear/linear` is Linear, `io.github.acme/tool` is acme).
 * The registry only accepts a namespace its publisher proved they own, but
 * Besidka does not review entries, so this is a label and never a trust
 * mark. Null when the name has no usable namespace.
 */
export function deriveConnectorPublisher(registryName: string): string | null {
  const namespace = registryName.split('/')[0] ?? ''
  const labels = namespace
    .split('.')
    .filter(label => /^[a-z0-9-]{1,40}$/i.test(label))

  if (labels.length < 2) {
    return null
  }

  const [, second = '', third = ''] = labels
  const publisher = CODE_HOSTING_LABELS.has(second.toLowerCase()) && third
    ? third
    : second

  return capitalize(publisher)
}
