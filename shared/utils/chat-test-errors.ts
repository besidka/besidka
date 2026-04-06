import type { ChatErrorCode, ChatErrorPayload } from '#shared/types/chat-errors.d'

export const chatTestErrorIds = [
  'provider-auth',
  'provider-rate-limit',
  'provider-quota-exceeded',
  'provider-unavailable',
  'message-persist-failed',
] as const

export type ChatTestErrorId = (typeof chatTestErrorIds)[number]

export interface ChatTestErrorConfig {
  id: ChatTestErrorId
  phase: 'prestream' | 'stream'
  status: number
  code: ChatErrorCode
  message: string
  why?: string
  fix?: string
  providerId?: 'openai' | 'google'
  providerRequestId?: string
}

export const chatTestErrors = {
  'provider-auth': {
    id: 'provider-auth',
    phase: 'prestream',
    status: 401,
    code: 'provider-auth',
    message: 'The provider rejected the API credentials.',
    why: 'The saved API key is missing, invalid, or does not allow this model.',
    fix: 'Update the provider API key in settings and try again.',
    providerId: 'openai',
    providerRequestId: 'req_test_provider_auth',
  },
  'provider-rate-limit': {
    id: 'provider-rate-limit',
    phase: 'prestream',
    status: 429,
    code: 'provider-rate-limit',
    message: 'The provider is rate limiting requests right now.',
    why: 'The upstream model provider is temporarily throttling requests.',
    fix: 'Wait a moment and retry the message.',
    providerId: 'openai',
    providerRequestId: 'req_test_provider_rate_limit',
  },
  'provider-quota-exceeded': {
    id: 'provider-quota-exceeded',
    phase: 'prestream',
    status: 429,
    code: 'provider-quota-exceeded',
    message: 'The provider quota has been exceeded.',
    why: 'The saved API key does not have enough remaining quota.',
    fix: 'Check provider billing or switch to a different saved key.',
    providerId: 'openai',
    providerRequestId: 'req_test_provider_quota',
  },
  'provider-unavailable': {
    id: 'provider-unavailable',
    phase: 'stream',
    status: 503,
    code: 'provider-unavailable',
    message: 'The provider failed to process this request.',
    why: 'The upstream model provider returned an internal error.',
    fix: 'Retry the message. If it keeps failing, try another model or provider.',
    providerId: 'openai',
    providerRequestId: 'req_test_provider_unavailable',
  },
  'message-persist-failed': {
    id: 'message-persist-failed',
    phase: 'stream',
    status: 500,
    code: 'message-persist-failed',
    message: 'The response could not be saved.',
    why: 'The response could not be stored in the database.',
    fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
    providerId: 'openai',
  },
} as const satisfies Record<ChatTestErrorId, ChatTestErrorConfig>

export function isChatTestErrorId(
  value: unknown,
): value is ChatTestErrorId {
  return typeof value === 'string' && value in chatTestErrors
}

export function toChatTestErrorPayload(
  errorId: ChatTestErrorId,
  requestId?: string,
): ChatErrorPayload {
  const error = chatTestErrors[errorId]

  return {
    code: error.code,
    message: error.message,
    why: error.why,
    fix: error.fix,
    status: error.status,
    requestId,
    providerId: error.providerId,
    providerRequestId: 'providerRequestId' in error
      ? error.providerRequestId
      : undefined,
  }
}
