import type { GatewayId } from './gateways.d'
import type { SupportedProviderId } from './providers.d'

export type ChatErrorCode
  = 'provider-rate-limit'
    | 'provider-quota-exceeded'
    | 'provider-unavailable'
    | 'provider-auth'
    | 'provider-model-restricted'
    | 'generation-busy'
    | 'storage-quota'
    | 'provider-safety'
    | 'invalid-provider-output'
    | 'image-save-failed'
    | 'message-persist-failed'
    | 'chat-request-invalid'
    | 'research-tier-required'
    | 'research-verification-required'
    | 'research-paid-tier-required'
    | 'research-timeout'
    | 'research-cancelled'
    | 'research-start-failed'
    | 'clarification-failed'
    | 'unknown'

export interface ChatErrorPayload {
  code: ChatErrorCode
  message: string
  why?: string
  fix?: string
  status?: number
  requestId?: string
  providerId?: SupportedProviderId | GatewayId
  providerRequestId?: string
}
