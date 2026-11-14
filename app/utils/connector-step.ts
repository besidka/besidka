import type { ConnectorToolCallModel } from '#shared/utils/connectors-parts'

const ARGUMENTS_MAX_LENGTH = 4000

export function getConnectorStepTitle(
  call: ConnectorToolCallModel,
  connectorTitle: string | undefined,
): string {
  const subject = `${connectorTitle || call.slug} · ${call.tool}`

  if (call.isRunning) {
    return `Using ${subject}`
  }

  if (call.outcome === 'denied') {
    return `Needs approval: ${subject}`
  }

  if (call.outcome === 'error') {
    return `Could not use ${subject}`
  }

  return `Used ${subject}`
}

export function isConnectorStepFailed(call: ConnectorToolCallModel): boolean {
  return call.outcome === 'error' || call.outcome === 'denied'
}

/**
 * The call's arguments as escaped, pretty-printed text for the collapsed
 * disclosure, or an empty string when the call had none.
 */
export function formatConnectorArguments(input: unknown): string {
  if (input === undefined || input === null) {
    return ''
  }

  if (
    typeof input === 'object'
    && !Array.isArray(input)
    && Object.keys(input).length === 0
  ) {
    return ''
  }

  let text: string

  try {
    text = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  } catch {
    return ''
  }

  if (!text) {
    return ''
  }

  return text.length > ARGUMENTS_MAX_LENGTH
    ? `${text.slice(0, ARGUMENTS_MAX_LENGTH)}…`
    : text
}
