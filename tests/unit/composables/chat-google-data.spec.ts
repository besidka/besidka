import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { computed, shallowRef } from 'vue'
import {
  useChatGoogleData,
  useGoogleDataRecipientReason,
} from '../../../app/composables/chat-google-data'
import {
  GOOGLE_DATA_GATEWAY_CONDITION_REASON,
  GOOGLE_DATA_PAID_TIER_REASON,
  GOOGLE_DATA_REFUSED_REASON,
} from '../../../shared/utils/google-data-recipient'

const mocks = vi.hoisted(() => ({
  routeSlug: null as unknown as { value: string },
  paidTierConfirmed: null as unknown as { value: boolean },
}))

mockNuxtImport('useChatRoute', () => {
  return () => ({ routeSlug: computed(() => mocks.routeSlug.value) })
})
mockNuxtImport('useUserKeys', () => {
  return () => ({
    isGeminiPaidTierConfirmed: computed(() => mocks.paidTierConfirmed.value),
  })
})

describe('useChatGoogleData', () => {
  beforeEach(() => {
    useState('chat-google-data:holds-by-slug').value = {}
  })

  it('remembers a chat that holds Google data and never forgets it', () => {
    const { isChatHoldingGoogleData, rememberChatGoogleData }
      = useChatGoogleData()

    expect(isChatHoldingGoogleData('chat-1')).toBe(false)

    rememberChatGoogleData('chat-1', true)
    rememberChatGoogleData('chat-1', false)

    expect(isChatHoldingGoogleData('chat-1')).toBe(true)
    expect(isChatHoldingGoogleData('chat-2')).toBe(false)
    expect(isChatHoldingGoogleData(null)).toBe(false)
  })
})

describe('useGoogleDataRecipientReason', () => {
  beforeEach(() => {
    useState('chat-google-data:holds-by-slug').value = {}
    mocks.routeSlug = shallowRef<string>('chat-1')
    mocks.paidTierConfirmed = shallowRef<boolean>(false)
  })

  it('blocks nothing in a chat without Google data', () => {
    const { holdsGoogleData, googleDataReasonFor }
      = useGoogleDataRecipientReason()

    expect(holdsGoogleData.value).toBe(false)
    expect(googleDataReasonFor({
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    })).toBe('')
  })

  it('gives the reason for each refused recipient in a flagged chat', () => {
    useChatGoogleData().rememberChatGoogleData('chat-1', true)

    const { holdsGoogleData, googleDataReasonFor }
      = useGoogleDataRecipientReason()

    expect(holdsGoogleData.value).toBe(true)
    expect(googleDataReasonFor({
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    })).toBe(GOOGLE_DATA_REFUSED_REASON)
    expect(googleDataReasonFor({
      providerId: 'google',
      modelId: 'gemini-4-argon',
    })).toBe(GOOGLE_DATA_PAID_TIER_REASON)
    expect(googleDataReasonFor({
      gatewayId: 'vercel',
      modelId: 'google/gemini-3-pro',
    })).toBe(GOOGLE_DATA_GATEWAY_CONDITION_REASON)
    expect(googleDataReasonFor({
      providerId: 'openai',
      modelId: 'gpt-6.1-sol',
    })).toBe('')
    expect(googleDataReasonFor({
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    })).toBe('')
  })

  it('allows Gemini once the paid tier is confirmed', () => {
    useChatGoogleData().rememberChatGoogleData('chat-1', true)
    mocks.paidTierConfirmed.value = true

    const { googleDataReasonFor } = useGoogleDataRecipientReason()

    expect(googleDataReasonFor({
      providerId: 'google',
      modelId: 'gemini-4-argon',
    })).toBe('')
  })
})
