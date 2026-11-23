import { describe, expect, it } from 'vitest'
import {
  GOOGLE_TOOLS_CALLING_OFF_REASON,
  GOOGLE_TOOLS_GATEWAY_REASON,
  getGoogleToolsUnavailableNote,
  getGoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type {
  GoogleToolsAvailabilityInput,
} from '#shared/utils/google-tools-availability'
import {
  GOOGLE_TOOLS_WITHHELD_NOTES,
  GOOGLE_TOOLS_WITHHELD_REASONS,
} from '#shared/utils/google-tools-withheld'

function input(
  overrides: Partial<GoogleToolsAvailabilityInput> = {},
): GoogleToolsAvailabilityInput {
  return {
    toolCalling: true,
    gateway: false,
    holdsGoogleData: false,
    providerToolsStayCallable: false,
    recipientAllowed: true,
    ...overrides,
  }
}

describe('getGoogleToolsUnavailableReason', () => {
  it('returns null when Google tools can be offered', () => {
    expect(getGoogleToolsUnavailableReason(input())).toBeNull()
  })

  it('says a gateway chat without Google data needs a file first', () => {
    expect(getGoogleToolsUnavailableReason(input({
      gateway: true,
      holdsGoogleData: false,
      recipientAllowed: true,
    }))).toBe(GOOGLE_TOOLS_GATEWAY_REASON)
  })

  it('says a model without tool calling gets no tools', () => {
    expect(getGoogleToolsUnavailableReason(input({ toolCalling: false })))
      .toBe(GOOGLE_TOOLS_CALLING_OFF_REASON)
  })

  it('says a provider tool stays callable in a chat without Google data',
    () => {
      expect(getGoogleToolsUnavailableReason(input({
        providerToolsStayCallable: true,
      }))).toBe('provider_tool_not_removable')
    })

  it('lets a provider tool through once the chat holds Google data', () => {
    expect(getGoogleToolsUnavailableReason(input({
      providerToolsStayCallable: true,
      holdsGoogleData: true,
    }))).toBeNull()
  })

  it('says the model may not receive Google data from the verdict', () => {
    expect(getGoogleToolsUnavailableReason(input({
      recipientAllowed: false,
    }))).toBe('model_may_not_receive_google_data')
  })

  it('judges the recipient with the shared allow-list without a verdict',
    () => {
      expect(getGoogleToolsUnavailableReason({
        toolCalling: true,
        gateway: false,
        holdsGoogleData: false,
        providerToolsStayCallable: false,
        recipient: { providerId: 'anthropic', modelId: 'claude-sonnet' },
      })).toBeNull()
      expect(getGoogleToolsUnavailableReason({
        toolCalling: true,
        gateway: false,
        holdsGoogleData: false,
        providerToolsStayCallable: false,
        recipient: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      })).toBe('model_may_not_receive_google_data')
    })

  it('needs the confirmed paid tier for a direct Gemini model', () => {
    const recipient = { providerId: 'google', modelId: 'gemini-pro' }
    const base = {
      toolCalling: true,
      gateway: false,
      holdsGoogleData: false,
      providerToolsStayCallable: false,
      recipient,
    }

    expect(getGoogleToolsUnavailableReason(base))
      .toBe('model_may_not_receive_google_data')
    expect(getGoogleToolsUnavailableReason({
      ...base,
      geminiPaidTierConfirmed: true,
    })).toBeNull()
  })

  it('counts the gateway safeguards as sent in a chat with Google data',
    () => {
      const reason = getGoogleToolsUnavailableReason({
        toolCalling: true,
        gateway: true,
        holdsGoogleData: true,
        providerToolsStayCallable: false,
        recipient: { gatewayId: 'vercel', modelId: 'anthropic/claude-sonnet' },
      })

      expect(reason).toBeNull()
    })

  it('refuses a gateway model that is not on the list even with data',
    () => {
      expect(getGoogleToolsUnavailableReason({
        toolCalling: true,
        gateway: true,
        holdsGoogleData: true,
        providerToolsStayCallable: false,
        recipient: { gatewayId: 'vercel', modelId: 'unknownvendor/model' },
      })).toBe('model_may_not_receive_google_data')
    })

  it('checks the gateway before tool calling, then tool calling before the '
    + 'provider tool, then the provider tool before the recipient', () => {
    expect(getGoogleToolsUnavailableReason(input({
      gateway: true,
      toolCalling: false,
      providerToolsStayCallable: true,
      recipientAllowed: false,
    }))).toBe(GOOGLE_TOOLS_GATEWAY_REASON)
    expect(getGoogleToolsUnavailableReason(input({
      toolCalling: false,
      providerToolsStayCallable: true,
      recipientAllowed: false,
    }))).toBe(GOOGLE_TOOLS_CALLING_OFF_REASON)
    expect(getGoogleToolsUnavailableReason(input({
      providerToolsStayCallable: true,
      recipientAllowed: false,
    }))).toBe('provider_tool_not_removable')
  })
})

describe('getGoogleToolsUnavailableNote', () => {
  it('reuses the withheld notes for the two withheld reasons', () => {
    for (const reason of GOOGLE_TOOLS_WITHHELD_REASONS) {
      expect(getGoogleToolsUnavailableNote(reason))
        .toEqual(GOOGLE_TOOLS_WITHHELD_NOTES[reason])
    }
  })

  it('tells the user to attach a Drive file first for the gateway reason',
    () => {
      expect(getGoogleToolsUnavailableNote(GOOGLE_TOOLS_GATEWAY_REASON)
        ?.detail).toContain('Attach a Drive file first')
    })

  it('has no text for a model without tool calling', () => {
    expect(getGoogleToolsUnavailableNote(GOOGLE_TOOLS_CALLING_OFF_REASON))
      .toBeNull()
  })
})
