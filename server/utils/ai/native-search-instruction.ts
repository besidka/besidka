import type { ModelTool } from '#shared/types/providers.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { buildCurrentDateInstruction } from '~~/server/utils/ai/current-date-instruction'

const NATIVE_SEARCH_TOOL_KEY = 'web_search_preview'

/**
 * A provider-native search tool left on the default `auto` tool choice is
 * only a suggestion to the model, so the Search toggle needs a nudge to keep
 * meaning "search". Providers that force the tool choice never need one.
 */
export function shouldNudgeNativeWebSearch(
  requestedTools: ModelTool[],
  parsedTools: FormattedTools,
): boolean {
  return requestedTools.includes('web_search')
    && !!parsedTools.tools?.[NATIVE_SEARCH_TOOL_KEY]
    && !parsedTools.toolChoice
}

export function buildNativeSearchInstruction(now: Date): string {
  return [
    'Web search is available via the web search tool.',
    'Search the web before answering when the question depends on current',
    'or recent information, specific facts, or anything you are not certain',
    'about.',
    buildCurrentDateInstruction(now),
  ].join(' ')
}
