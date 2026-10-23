export const EXA_SEARCH_LEVELS = ['lite', 'auto', 'deep'] as const

export type ExaSearchLevel = typeof EXA_SEARCH_LEVELS[number]

export const DEFAULT_EXA_SEARCH_LEVEL: ExaSearchLevel = 'auto'

export const EXA_SEARCH_LEVEL_LABELS: Record<ExaSearchLevel, string> = {
  lite: 'Lite',
  auto: 'Auto',
  deep: 'Deep',
}

export const EXA_SEARCH_LEVEL_RATE_CONFIG_KEYS = {
  lite: 'exaLiteSearchCostPerThousandRequestsUsd',
  auto: 'exaSearchCostPerThousandRequestsUsd',
  deep: 'exaDeepSearchCostPerThousandRequestsUsd',
} as const satisfies Record<ExaSearchLevel, string>

export function isExaSearchLevel(value: unknown): value is ExaSearchLevel {
  return typeof value === 'string'
    && (EXA_SEARCH_LEVELS as readonly string[]).includes(value)
}

export function normalizeExaSearchLevel(value: unknown): ExaSearchLevel {
  return isExaSearchLevel(value) ? value : DEFAULT_EXA_SEARCH_LEVEL
}
