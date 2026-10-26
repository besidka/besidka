import type {
  KnowledgeSearchHit,
  KnowledgeSearchResult,
} from '#shared/types/project-knowledge.d'
import type {
  KnowledgeSearcher,
  KnowledgeSearchInput,
} from '~~/server/utils/knowledge/search'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { rerankWithJev } from '~~/server/utils/jev/rerank'
import type { JevRerankModelResolver } from '~~/server/utils/jev/rerank'

function buildKnowledgePassage(hit: KnowledgeSearchHit): string {
  return [hit.breadcrumb, hit.text].filter(Boolean).join('\n')
}

/**
 * Searches the project knowledge index and, when the user has a TypeSafe AI
 * key with the `rerank` role on, re-ranks the ranked MiniSearch candidates
 * with Jev before the chunk and token caps cut them. Without a resolver,
 * without a model, or with fewer than two candidates it is exactly
 * `searcher.search`. `keepAtLeast` is the chunk limit of the caller: the
 * relevance cut never leaves fewer hits than that.
 */
export async function searchKnowledgeWithRerank(input: {
  searcher: KnowledgeSearcher
  search: KnowledgeSearchInput
  keepAtLeast: number
  resolveRerankModel?: JevRerankModelResolver
  logger?: JevLogger
}): Promise<KnowledgeSearchResult> {
  if (!input.resolveRerankModel) {
    return input.searcher.search(input.search)
  }

  const candidates = input.searcher.searchCandidates(input.search)

  if (candidates.hits.length < 2) {
    return input.searcher.capHits(candidates.hits, candidates.operator)
  }

  const model = await input.resolveRerankModel()
  const hits = await rerankWithJev({
    model,
    query: input.search.query,
    candidates: candidates.hits,
    passageOf: buildKnowledgePassage,
    keepAtLeast: input.keepAtLeast,
    logger: input.logger,
  })

  return input.searcher.capHits(hits, candidates.operator)
}
