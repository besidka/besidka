import type { RequestLogger } from 'evlog'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { GatewayId } from '#shared/types/gateways.d'
import type { SupportedProviderId } from '#shared/types/providers.d'
import {
  readProviderErrorDetails,
  summarizeProviderError,
} from '~~/server/utils/chats/provider-error-summary'

export interface StreamErrorTelemetry {
  stage: string
  code: ChatErrorPayload['code']
  status?: number
  providerStatus?: number
  providerCode?: string
  attempts?: number
  summary?: string
}

interface StreamErrorTelemetryInput {
  chatError: ChatErrorPayload
  error: unknown
  stage: string
  providerId?: SupportedProviderId | GatewayId
}

/**
 * What the dedicated `AI stream completed` wide event records about a failed
 * send: the chat error code and status the client got, the provider's own
 * HTTP status and short error code, the SDK's attempt count and the safe
 * provider summary. Built only from `readProviderErrorDetails` and
 * `summarizeProviderError`, so it never carries URLs, keys or request
 * content.
 */
export function buildStreamErrorTelemetry(
  input: StreamErrorTelemetryInput,
): StreamErrorTelemetry {
  const details = readProviderErrorDetails(input.error)
  const summary = summarizeProviderError(input.error, input.providerId)

  return {
    stage: input.stage,
    code: input.chatError.code,
    status: input.chatError.status,
    ...(details.status === undefined
      ? {}
      : { providerStatus: details.status }),
    ...(details.code ? { providerCode: details.code } : {}),
    ...(details.attempts === undefined ? {} : { attempts: details.attempts }),
    ...(summary ? { summary } : {}),
  }
}

export function recordStreamError(
  input: StreamErrorTelemetryInput,
  logger: RequestLogger,
): void {
  logger.set({
    errorCode: input.chatError.code,
    attributes: {
      streamError: { ...buildStreamErrorTelemetry(input) },
    },
  })
}
