export type ChatErrorCode
  = 'provider-rate-limit'
    | 'provider-quota-exceeded'
    | 'provider-unavailable'
    | 'provider-auth'
    | 'generation-busy'
    | 'storage-quota'
    | 'provider-safety'
    | 'invalid-provider-output'
    | 'image-save-failed'
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
