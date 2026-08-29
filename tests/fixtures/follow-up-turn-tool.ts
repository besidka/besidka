import { tool } from 'ai'
import { z } from 'zod'
import { withFollowUpTurn } from '../../server/utils/ai/tool-loop'

export const FIXTURE_FOLLOW_UP_TOOL_NAME = 'fixture_search'

interface CreateFixtureFollowUpToolInput {
  onExecute?: (query: string) => void
  result?: unknown
  shouldThrow?: boolean
}

/**
 * A minimal tool that opts into the multi-step loop, used only by the loop
 * tests. It stands in for Moonshot AI's Formula-API web search — the real,
 * shipped consumer of `withFollowUpTurn()` — so the loop can be proven
 * end-to-end without a live provider round-trip and without pinning the
 * tests to that tool's remote declaration. Never wire this into a provider
 * builder.
 */
export function createFixtureFollowUpTool(
  input: CreateFixtureFollowUpToolInput = {},
) {
  return withFollowUpTurn(tool({
    description: 'Test-only tool that returns canned search results.',
    inputSchema: z.object({
      query: z.string(),
    }),
    async execute({ query }) {
      input.onExecute?.(query)

      if (input.shouldThrow) {
        throw new Error('fixture tool failed')
      }

      return input.result ?? {
        results: [{ title: `Result for ${query}`, url: 'https://example.com' }],
      }
    },
  }))
}
