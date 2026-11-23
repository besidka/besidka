import { describe, expect, it, vi } from 'vitest'
import { getGoogleSendTools } from '~~/server/utils/tool-approval/google-send-tools'

type Reason = 'provider_tool_not_removable'
  | 'model_may_not_receive_google_data'
  | null

interface Outcome {
  offered: boolean
  reason: Reason
  guardCalled: boolean
}

function legacyOutcome(facts: {
  toolCallingAllowed: boolean | undefined
  providerToolsStayCallable: boolean
  holdsGoogleData: boolean
  recipientAllowed: boolean
}): Outcome {
  if (facts.toolCallingAllowed === false) {
    return { offered: false, reason: null, guardCalled: false }
  }

  if (facts.providerToolsStayCallable && !facts.holdsGoogleData) {
    return {
      offered: false,
      reason: 'provider_tool_not_removable',
      guardCalled: false,
    }
  }

  if (!facts.recipientAllowed) {
    return {
      offered: false,
      reason: 'model_may_not_receive_google_data',
      guardCalled: true,
    }
  }

  return { offered: true, reason: null, guardCalled: true }
}

function plan() {
  return {
    candidates: {
      tools: { google__drive_search: { execute: vi.fn() } },
      entries: new Map([['google__drive_search', {}]]),
    } as never,
    gatewaySafeguards: false,
  }
}

describe('getGoogleSendTools against the order it had before the shared '
  + 'predicate', () => {
  const toolCallingValues = [undefined, true, false]
  const booleans = [false, true]

  for (const toolCallingAllowed of toolCallingValues) {
    for (const providerToolsStayCallable of booleans) {
      for (const holdsGoogleData of booleans) {
        for (const recipientAllowed of booleans) {
          const label = `toolCalling=${String(toolCallingAllowed)} `
            + `providerTool=${providerToolsStayCallable} `
            + `holds=${holdsGoogleData} recipientAllowed=${recipientAllowed}`

          it(`answers like before for ${label}`, async () => {
            const mayReceiveGoogleData = vi.fn(async () => recipientAllowed)
            const decision = await getGoogleSendTools({
              plan: plan(),
              mayReceiveGoogleData,
              holdsGoogleData,
              providerToolsStayCallable,
              ...(toolCallingAllowed === undefined
                ? {}
                : { toolCallingAllowed }),
              logger: { set: vi.fn(), warn: vi.fn() },
            })
            const expected = legacyOutcome({
              toolCallingAllowed,
              providerToolsStayCallable,
              holdsGoogleData,
              recipientAllowed,
            })

            expect(Object.keys(decision.tools).length > 0)
              .toBe(expected.offered)
            expect(decision.withheldReason).toBe(expected.reason)
            expect(mayReceiveGoogleData.mock.calls.length > 0)
              .toBe(expected.guardCalled)
          })
        }
      }
    }
  }

  it('writes the same log label for each reason', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ toolCallingAllowed: false }, 'tool-calling-off'],
      [
        { providerToolsStayCallable: true, holdsGoogleData: false },
        'provider-tools-declared',
      ],
      [{ recipientAllowed: false }, 'recipient-refused'],
    ]

    for (const [overrides, label] of cases) {
      const logger = { set: vi.fn(), warn: vi.fn() }

      await getGoogleSendTools({
        plan: plan(),
        mayReceiveGoogleData: async () => overrides.recipientAllowed !== false,
        ...overrides,
        logger,
      } as never)

      expect(logger.set).toHaveBeenCalledWith({
        attributes: { googleDataGuard: { googleTools: label } },
      })
    }
  })
})
