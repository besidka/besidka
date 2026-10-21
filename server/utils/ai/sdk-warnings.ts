import type { Warning } from 'ai'

export const MAX_LOGGED_SDK_WARNINGS = 10
const MAX_WARNING_TEXT_LENGTH = 300

export interface SerializedSdkWarning {
  type: Warning['type']
  feature?: string
  setting?: string
  message?: string
  details?: string
}

export interface SdkWarningsSummary {
  count: number
  warnings: SerializedSdkWarning[]
}

interface StepWithWarnings {
  warnings?: readonly Warning[]
}

function truncateWarningText(value: string): string {
  return value.length > MAX_WARNING_TEXT_LENGTH
    ? `${value.slice(0, MAX_WARNING_TEXT_LENGTH)}…`
    : value
}

export function serializeSdkWarning(warning: Warning): SerializedSdkWarning {
  const serialized: SerializedSdkWarning = { type: warning.type }

  if ('feature' in warning && typeof warning.feature === 'string') {
    serialized.feature = truncateWarningText(warning.feature)
  }

  if ('setting' in warning && typeof warning.setting === 'string') {
    serialized.setting = truncateWarningText(warning.setting)
  }

  if ('message' in warning && typeof warning.message === 'string') {
    serialized.message = truncateWarningText(warning.message)
  }

  if ('details' in warning && typeof warning.details === 'string') {
    serialized.details = truncateWarningText(warning.details)
  }

  return serialized
}

/**
 * Flattens every step's AI SDK call warnings (unsupported file types,
 * ignored settings, compatibility fallbacks) into a capped, loggable summary.
 * `count` is the uncapped total so a truncated list is still detectable.
 * Returns `undefined` when no step produced a warning, so callers can skip
 * the log write entirely.
 */
export function summarizeSdkWarnings(
  steps: readonly StepWithWarnings[],
): SdkWarningsSummary | undefined {
  const warnings = steps.flatMap(step => step.warnings ?? [])

  if (warnings.length === 0) {
    return undefined
  }

  return {
    count: warnings.length,
    warnings: warnings
      .slice(0, MAX_LOGGED_SDK_WARNINGS)
      .map(serializeSdkWarning),
  }
}
