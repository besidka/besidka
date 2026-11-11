import type { CodeExecutionProvider } from '#shared/utils/code-execution'

export interface CodeExecutionRates {
  openaiPerSessionUsd: number | undefined
  anthropicPerHourUsd: number | undefined
  anthropicFreeHoursPerMonth: number | undefined
}

export interface CodeExecutionCostConfig {
  openaiCodeInterpreterCostPerSessionUsd?: string | number
  anthropicCodeExecutionCostPerHourUsd?: string | number
  anthropicCodeExecutionFreeHoursPerMonth?: string | number
}

export interface CodeExecutionUsage {
  provider: CodeExecutionProvider
  calls: number
  containers: number
  files: number
  bytes: number
  skipped: number
  containerSeconds?: number
}

function parseRate(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function resolveCodeExecutionRates(
  config: CodeExecutionCostConfig,
): CodeExecutionRates {
  return {
    openaiPerSessionUsd: parseRate(
      config.openaiCodeInterpreterCostPerSessionUsd,
    ),
    anthropicPerHourUsd: parseRate(
      config.anthropicCodeExecutionCostPerHourUsd,
    ),
    anthropicFreeHoursPerMonth: parseRate(
      config.anthropicCodeExecutionFreeHoursPerMonth,
    ),
  }
}

/**
 * "Always record the count, conditionally record the cost". OpenAI bills one
 * container session per container the send used, at the configured rate.
 * Anthropic bills container time after an organisation-wide free allowance
 * that Besidka cannot see, and its responses carry no billable usage, so the
 * cost is `null` rather than a guess. Gemini adds no charge beyond tokens.
 */
export function getCodeExecutionCost(
  usage: CodeExecutionUsage,
  rates: CodeExecutionRates,
): number | null {
  if (usage.calls === 0) {
    return null
  }

  if (usage.provider === 'google') {
    return 0
  }

  if (usage.provider === 'openai') {
    if (rates.openaiPerSessionUsd === undefined) {
      return null
    }

    return Math.max(usage.containers, 1) * rates.openaiPerSessionUsd
  }

  return null
}

export function describeCodeExecutionUsage(
  usage: CodeExecutionUsage,
  rates: CodeExecutionRates,
) {
  const cost = getCodeExecutionCost(usage, rates)

  return {
    provider: usage.provider,
    calls: usage.calls,
    containers: usage.containers,
    files: usage.files,
    bytes: usage.bytes,
    skipped: usage.skipped,
    ...(usage.containerSeconds === undefined
      ? {}
      : { containerSeconds: usage.containerSeconds }),
    ...(cost === null ? {} : { cost }),
  }
}
