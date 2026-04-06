export type ChatErrorCode
  = 'provider-rate-limit'
    | 'provider-quota-exceeded'
    | 'provider-unavailable'
    | 'provider-auth'
    | 'message-persist-failed'
    | 'chat-request-invalid'
    | 'unknown'

export interface ChatErrorPayload {
  code: ChatErrorCode
  message: string
  why?: string
  fix?: string
  status?: number
  requestId?: string
  providerId?: 'openai' | 'google'
  providerRequestId?: string
}
