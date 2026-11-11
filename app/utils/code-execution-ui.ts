import type { Tools } from '#shared/types/chats.d'
import {
  CODE_EXECUTION_CODE_MAX_BYTES,
  CODE_EXECUTION_PART_TYPE,
  CODE_EXECUTION_STREAM_MAX_BYTES,
  isDataCodeExecutionFilesPart,
} from '#shared/utils/code-execution'
import type {
  CodeExecutionLanguage,
  CodeExecutionSkippedFile,
} from '#shared/utils/code-execution'

export const CODE_EXECUTION_TOOL_LABEL = 'Run code'
export const CODE_EXECUTION_TOOL_ICON = 'lucide:square-terminal'
export const CODE_EXECUTION_PREVIEW_LINES = 4

const CONFIRMATION_KEY_PREFIX = 'besidka:code-execution-confirmed:'
const PRICING_FALLBACK = 'see your provider\'s pricing'
const SANDBOX_DISCLAIMER = 'The provider runs the code; Besidka never '
  + 'executes it.'

const BYTES_PER_KILOBYTE = 1024
const LANGUAGE_LABELS: Record<CodeExecutionLanguage, string> = {
  python: 'Python',
  bash: 'Bash',
  text: 'Text',
}

export const CODE_EXECUTION_CODE_TRUNCATED_NOTICE = `Code was truncated to ${
  CODE_EXECUTION_CODE_MAX_BYTES / BYTES_PER_KILOBYTE
} KB.`
export const CODE_EXECUTION_STREAM_TRUNCATED_NOTICE
  = `Output was truncated to ${
    CODE_EXECUTION_STREAM_MAX_BYTES / BYTES_PER_KILOBYTE
  } KB.`

type PublicConfig = Record<string, unknown>

export function getCodeExecutionLanguageLabel(
  language: CodeExecutionLanguage,
): string {
  return LANGUAGE_LABELS[language]
}

export function stripCodeExecutionTool(tools: Tools): Tools {
  return tools.filter((tool) => {
    return tool !== 'code_execution'
  })
}

export function isCodeExecutionPart(part: unknown): boolean {
  return typeof part === 'object'
    && part !== null
    && (part as { type?: unknown }).type === CODE_EXECUTION_PART_TYPE
}

export function getCodeExecutionSkippedFiles(
  parts: readonly unknown[],
): CodeExecutionSkippedFile[] {
  return parts.flatMap((part) => {
    return isDataCodeExecutionFilesPart(part) ? part.data.skipped : []
  })
}

export function isLastCodeExecutionPart(
  parts: readonly unknown[],
  part: unknown,
): boolean {
  const lastIndex = parts.findLastIndex(isCodeExecutionPart)

  return lastIndex >= 0 && parts[lastIndex] === part
}

export function getCodePreview(
  code: string,
  maxLines: number = CODE_EXECUTION_PREVIEW_LINES,
): { text: string, hiddenLineCount: number } {
  const lines = code.split('\n')

  if (lines.length <= maxLines) {
    return { text: code, hiddenLineCount: 0 }
  }

  return {
    text: lines.slice(0, maxLines).join('\n'),
    hiddenLineCount: lines.length - maxLines,
  }
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }

  if (typeof value === 'string' && value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function formatUsd(amount: number): string {
  return `$${amount}`
}

function formatCount(amount: number): string {
  return amount.toLocaleString('en-US')
}

function getAnthropicNote(config: PublicConfig): string {
  const hourlyRate = readPositiveNumber(
    config.anthropicCodeExecutionCostPerHourUsd,
  )
  const freeHours = readPositiveNumber(
    config.anthropicCodeExecutionFreeHoursPerMonth,
  )
  const rateText = hourlyRate === undefined
    ? `(${PRICING_FALLBACK})`
    : `at ${formatUsd(hourlyRate)} per hour`
  const freeText = freeHours === undefined
    ? ''
    : ` after ${formatCount(freeHours)} free hours a month for your `
      + 'organisation'

  return 'Runs in Anthropic\'s sandbox on your API key. Anthropic bills '
    + `container time ${rateText}${freeText}, with a 5-minute minimum, and `
    + 'bills attached files even if no code runs. Free hours depend on '
    + 'your organisation.'
}

function getOpenAiNote(config: PublicConfig): string {
  const sessionRate = readPositiveNumber(
    config.openaiCodeInterpreterCostPerSessionUsd,
  )
  const billing = sessionRate === undefined
    ? `bills container sessions separately from tokens (${PRICING_FALLBACK})`
    : `bills about ${formatUsd(sessionRate)} per container session (1 GB, up `
      + 'to 20 minutes), separate from tokens'

  return `Runs in OpenAI's sandbox on your API key. OpenAI ${billing}.`
}

const GOOGLE_NOTE = 'Runs in Google\'s sandbox on your Gemini key. There is '
  + 'no extra charge beyond tokens. On a free key outside the EEA, '
  + 'Switzerland and the UK, files you attach may be used by Google and '
  + 'read by reviewers.'

const GENERIC_NOTE = 'Runs in your provider\'s sandbox on your API key. '
  + 'See your provider\'s pricing.'

export function getCodeExecutionNote(
  providerId: string | null | undefined,
  config: PublicConfig,
): string {
  const providerNote = providerId === 'anthropic'
    ? getAnthropicNote(config)
    : providerId === 'openai'
      ? getOpenAiNote(config)
      : providerId === 'google'
        ? GOOGLE_NOTE
        : GENERIC_NOTE

  return `${providerNote} ${SANDBOX_DISCLAIMER}`
}

function getConfirmationKey(providerId: string): string {
  return `${CONFIRMATION_KEY_PREFIX}${providerId}`
}

export function readCodeExecutionConfirmed(providerId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(
      getConfirmationKey(providerId),
    ) === 'true'
  } catch {
    return false
  }
}

export function writeCodeExecutionConfirmed(providerId: string): void {
  try {
    globalThis.localStorage?.setItem(getConfirmationKey(providerId), 'true')
  } catch {
    return
  }
}
