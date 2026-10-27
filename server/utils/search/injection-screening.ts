import type { Experimental_DecisionModel } from 'ai'
import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import { screenTextsForInjection } from '~~/server/utils/jev/injection-screening'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import type {
  ExternalSearchResult,
  ExternalSearchToolOutput,
} from '~~/server/utils/search/types.d'

type DbClient = ReturnType<typeof useDb>

export type ExternalSearchScreener = (
  output: ExternalSearchToolOutput,
  abortSignal?: AbortSignal,
) => Promise<ExternalSearchToolOutput>

function resultText(result: ExternalSearchResult): string {
  return [result.title, result.snippet].filter(Boolean).join('\n')
}

export function formatWithheldNotice(withheldCount: number): string {
  if (withheldCount === 1) {
    return '1 search result was withheld as a possible prompt injection.'
  }

  return `${withheldCount} search results were withheld as possible prompt `
    + 'injections.'
}

/**
 * Screens Brave or Exa results with Jev once they arrive, inside the tool's
 * `execute`, with the send-path timeout per call. Flagged results are
 * removed from the output and a one-line `notice` says how many were
 * withheld. A result Jev did not answer for (401, 429, timeout, network) is
 * kept, so a failure returns the results exactly as without the key.
 */
export function createExternalSearchScreener(input: {
  model: Experimental_DecisionModel
  logger?: JevLogger
}): ExternalSearchScreener {
  return async (output, abortSignal) => {
    if (output.results.length === 0) {
      return output
    }

    const verdicts = await screenTextsForInjection({
      model: input.model,
      texts: output.results.map(resultText),
      source: 'search',
      timeoutMs: JEV_INJECTION_SCREENING.searchResultsTimeoutMs,
      abortSignal,
      logger: input.logger,
    })
    const keptResults = output.results.filter((_result, index) => {
      return verdicts[index] !== 'flagged'
    })
    const withheldCount = output.results.length - keptResults.length

    if (withheldCount === 0) {
      return output
    }

    return {
      ...output,
      results: keptResults,
      notice: formatWithheldNotice(withheldCount),
    }
  }
}

/**
 * The screener for a send with Brave or Exa search, or `null` when the user
 * has no TypeSafe AI key or switched injection screening off. Resolved once
 * per request, before the stream, next to the search key reads.
 */
export async function resolveExternalSearchScreener(input: {
  db: DbClient
  userId: number
  logger?: JevLogger
}): Promise<ExternalSearchScreener | null> {
  const model = await resolveJevRoleModel({
    ...input,
    role: 'injectionScreening',
  })

  return model
    ? createExternalSearchScreener({ model, logger: input.logger })
    : null
}
