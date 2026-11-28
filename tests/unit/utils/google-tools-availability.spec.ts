import { describe, expect, it } from 'vitest'
import {
  GOOGLE_TOOLS_CALLING_OFF_REASON,
  GOOGLE_TOOLS_GATEWAY_REASON,
  getGoogleToolsUnavailableActions,
  getGoogleToolsUnavailableNote,
  getGoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type {
  GoogleToolsAvailabilityInput,
} from '#shared/utils/google-tools-availability'
import { GOOGLE_TOOLS_WITHHELD_NOTES } from '#shared/utils/google-tools-withheld'

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
  it('reuses the withheld note of the provider tool reason', () => {
    expect(getGoogleToolsUnavailableNote('provider_tool_not_removable'))
      .toEqual(GOOGLE_TOOLS_WITHHELD_NOTES.provider_tool_not_removable)
  })

  it('keeps the paid-tier text and link for Gemini and for a gateway',
    () => {
      const note = GOOGLE_TOOLS_WITHHELD_NOTES.model_may_not_receive_google_data

      expect(getGoogleToolsUnavailableNote(
        'model_may_not_receive_google_data',
        { providerId: 'google' },
      )).toEqual(note)
      expect(getGoogleToolsUnavailableNote(
        'model_may_not_receive_google_data',
        { providerId: null, isGateway: true },
      )).toEqual(note)
    })

  it('names DeepSeek and Moonshot AI and offers no keys link', () => {
    for (const [providerId, name] of [
      ['deepseek', 'DeepSeek'],
      ['moonshotai', 'Moonshot AI'],
    ] as const) {
      const note = getGoogleToolsUnavailableNote(
        'model_may_not_receive_google_data',
        { providerId },
      )

      expect(note?.detail).toBe(
        `${name} may use API inputs for training, so Besidka does not send `
        + 'Google data to it. Pick Anthropic, OpenAI, xAI or Gemini on a paid '
        + 'key.',
      )
      expect(note?.linkLabel).toBeNull()
    }
  })

  it('explains the Qwen condition without a keys link', () => {
    const note = getGoogleToolsUnavailableNote(
      'model_may_not_receive_google_data',
      { providerId: 'qwen' },
    )

    expect(note?.detail).toContain(
      'Qwen is allowed for Google data only on models Alibaba serves itself',
    )
    expect(note?.linkLabel).toBeNull()
  })

  it('stays neutral for an unknown recipient', () => {
    const note = getGoogleToolsUnavailableNote(
      'model_may_not_receive_google_data',
    )

    expect(note?.detail).toBe(
      'Besidka does not send Google data to a model that may use it for '
      + 'training. Pick another model.',
    )
    expect(note?.linkLabel).toBeNull()
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

describe('getGoogleToolsUnavailableActions', () => {
  const keysLink = {
    kind: 'open-api-keys',
    label: 'Open API Keys',
    path: '/profile/keys?provider=google',
  }
  const chooseModel = {
    kind: 'choose-model',
    label: 'Choose another model',
  }

  it('offers the keys link and the inline confirmation for Gemini with a '
    + 'saved key', () => {
    expect(getGoogleToolsUnavailableActions(
      'model_may_not_receive_google_data',
      {
        recipientProviderId: 'google',
        hasGeminiKey: true,
        geminiPaidTierConfirmed: false,
      },
    )).toEqual([keysLink, { kind: 'confirm-paid-tier' }])
  })

  it('offers only the keys link for Gemini without a saved key', () => {
    expect(getGoogleToolsUnavailableActions(
      'model_may_not_receive_google_data',
      {
        recipientProviderId: 'google',
        hasGeminiKey: false,
        geminiPaidTierConfirmed: false,
      },
    )).toEqual([keysLink])
  })

  it('never offers the confirmation again for a confirmed Gemini key that '
    + 'is still refused, and offers another model instead', () => {
    expect(getGoogleToolsUnavailableActions(
      'model_may_not_receive_google_data',
      {
        recipientProviderId: 'google',
        hasGeminiKey: true,
        geminiPaidTierConfirmed: true,
      },
    )).toEqual([keysLink, chooseModel])
  })

  it('offers only a way to another model for DeepSeek, Moonshot AI and '
    + 'Qwen, whatever the Gemini key says', () => {
    for (const recipientProviderId of ['deepseek', 'moonshotai', 'qwen']) {
      for (const geminiPaidTierConfirmed of [false, true]) {
        expect(getGoogleToolsUnavailableActions(
          'model_may_not_receive_google_data',
          {
            recipientProviderId,
            hasGeminiKey: true,
            geminiPaidTierConfirmed,
          },
        )).toEqual([chooseModel])
      }
    }
  })

  it('offers only a way to another model for an unknown direct recipient',
    () => {
      expect(getGoogleToolsUnavailableActions(
        'model_may_not_receive_google_data',
        {
          recipientProviderId: null,
          hasGeminiKey: true,
          geminiPaidTierConfirmed: false,
        },
      )).toEqual([chooseModel])
    })

  it('keeps the keys link and a way to another model for a gateway', () => {
    expect(getGoogleToolsUnavailableActions(
      'model_may_not_receive_google_data',
      {
        recipientProviderId: null,
        isGateway: true,
        hasGeminiKey: true,
        geminiPaidTierConfirmed: false,
      },
    )).toEqual([keysLink, chooseModel])
  })

  it('offers nothing for the other reasons', () => {
    for (const reason of [
      'provider_tool_not_removable',
      GOOGLE_TOOLS_GATEWAY_REASON,
      GOOGLE_TOOLS_CALLING_OFF_REASON,
    ] as const) {
      expect(getGoogleToolsUnavailableActions(
        reason,
        {
          recipientProviderId: 'deepseek',
          hasGeminiKey: true,
          geminiPaidTierConfirmed: false,
        },
      )).toEqual([])
    }
  })
})
