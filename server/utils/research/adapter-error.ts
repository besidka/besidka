export class ResearchAdapterError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    super(extractResearchAdapterErrorMessage(body, status))

    this.status = status
    this.body = body
  }
}

export async function readResearchAdapterErrorBody(
  response: Response,
): Promise<unknown> {
  try {
    return await response.json()
  } catch (exception) {
    void exception

    try {
      return await response.text()
    } catch (textException) {
      void textException

      return null
    }
  }
}

function extractResearchAdapterErrorMessage(
  body: unknown,
  status: number,
): string {
  return redactProviderSecrets(
    resolveRawResearchAdapterErrorMessage(body, status),
  )
}

function resolveRawResearchAdapterErrorMessage(
  body: unknown,
  status: number,
): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const nestedError = record.error

    if (nestedError && typeof nestedError === 'object') {
      const message = (nestedError as Record<string, unknown>).message

      if (typeof message === 'string' && message.length > 0) {
        return message
      }
    }

    const directMessage = record.message

    if (typeof directMessage === 'string' && directMessage.length > 0) {
      return directMessage
    }
  }

  return `Research provider request failed with status ${status}`
}

const MASKED_TOKEN_PATTERN = /\S*\*{4,}\S*/g
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9*_-]+/g

function redactProviderSecrets(message: string): string {
  return message
    .replace(MASKED_TOKEN_PATTERN, '[redacted]')
    .replace(OPENAI_KEY_PATTERN, '[redacted]')
}

export function describeResearchAdapterException(
  exception: unknown,
): { message: string, status?: number } {
  if (exception instanceof ResearchAdapterError) {
    return { message: exception.message, status: exception.status }
  }

  return { message: 'unexpected' }
}
