import type {
  FinishReason,
  LanguageModelUsage,
  ModelMessage,
  UIMessageChunk,
} from 'ai'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const SEARCH_ANSWER_CONTEXT_MAX_RESULTS = 24
export const SEARCH_ANSWER_CONTEXT_MAX_CHARS = 16_000
export const SEARCH_ANSWER_SNIPPET_MAX_CHARS = 600
export const SEARCH_ANSWER_OPAQUE_OUTPUT_MAX_CHARS = 4_000

const SEARCH_ANSWER_INSTRUCTIONS = [
  'Your search budget is used up and no tools are available any more.',
  'Answer the user\'s last message now, using the search results above',
  'together with what you already know. Cite the sources you rely on',
  'inline as markdown links. Reply in the same language as the user\'s',
  'last message.',
].join(' ')

const SEARCH_ANSWER_OMITTED_NOTICE = '(Further search results omitted.)'

export interface CollectedSearchResult {
  toolName: string
  input: unknown
  output?: unknown
  errorText?: string
}

export interface SearchAnswerContinuationStep {
  usage: LanguageModelUsage
  providerMetadata?: unknown
  content?: unknown
}

export interface SearchAnswerContinuationResult {
  usage: LanguageModelUsage
  steps: SearchAnswerContinuationStep[]
  finishReason: FinishReason | undefined
}

export interface SearchAnswerContinuationRun {
  stream: ReadableStream<UIMessageChunk>
  settle: () => Promise<SearchAnswerContinuationResult>
}

export interface SearchAnswerOutcome {
  stepsCount: number
  forcedStepToolCall: boolean
  continuationRan: boolean
  continuationProducedText: boolean
  continuationError: string | undefined
  finishReason: FinishReason | undefined
  continuation: SearchAnswerContinuationResult | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}…`
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function readSearchQuery(input: unknown): string {
  if (isRecord(input) && typeof input.query === 'string') {
    return input.query
  }

  return truncate(stringifyUnknown(input), SEARCH_ANSWER_SNIPPET_MAX_CHARS)
}

function readResultSnippet(result: Record<string, unknown>): string {
  const textCandidates = [result.snippet, result.description, result.text]
  const textSnippet = textCandidates.find((candidate) => {
    return typeof candidate === 'string' && candidate.trim().length > 0
  })

  if (typeof textSnippet === 'string') {
    return textSnippet
  }

  if (Array.isArray(result.highlights)) {
    return result.highlights
      .filter((highlight): highlight is string => {
        return typeof highlight === 'string'
      })
      .join(' … ')
  }

  return ''
}

function renderStructuredResult(
  result: Record<string, unknown>,
  position: number,
): string {
  const title = typeof result.title === 'string' && result.title
    ? result.title
    : 'Untitled result'
  const lines = [`${position}. ${title}`]

  if (typeof result.url === 'string' && result.url) {
    lines.push(`   URL: ${result.url}`)
  }

  const snippet = readResultSnippet(result)

  if (snippet) {
    lines.push(`   ${truncate(snippet, SEARCH_ANSWER_SNIPPET_MAX_CHARS)}`)
  }

  return lines.join('\n')
}

/**
 * Flattens the follow-up tool results of one turn into plain text, so the
 * tool-less continuation can read them without any tool-call history (which
 * Anthropic and Gemini reject when no tools are declared). Brave/Exa-shaped
 * outputs (`results[].{title,url,snippet}`) render as a numbered list;
 * anything else (Moonshot's opaque Formula output) is stringified and
 * truncated. Total size is bounded by result count and characters so a
 * long search turn cannot blow up the continuation's input cost.
 */
export function buildSearchResultsContext(
  searchResults: readonly CollectedSearchResult[],
): string {
  const sections: string[] = []
  let renderedResults = 0
  let renderedChars = 0
  let isTruncated = false

  for (const [searchIndex, searchResult] of searchResults.entries()) {
    if (isTruncated) {
      break
    }

    const query = readSearchQuery(searchResult.input)
    const lines = [`Search ${searchIndex + 1}: ${query}`]

    if (searchResult.errorText !== undefined) {
      lines.push(`The search failed: ${truncate(
        searchResult.errorText,
        SEARCH_ANSWER_SNIPPET_MAX_CHARS,
      )}`)
    } else if (
      isRecord(searchResult.output)
      && Array.isArray(searchResult.output.results)
    ) {
      const results = searchResult.output.results.filter(isRecord)

      if (results.length === 0) {
        lines.push('No results.')
      }

      for (const [resultIndex, result] of results.entries()) {
        const rendered = renderStructuredResult(result, resultIndex + 1)

        if (
          renderedResults >= SEARCH_ANSWER_CONTEXT_MAX_RESULTS
          || renderedChars + rendered.length > SEARCH_ANSWER_CONTEXT_MAX_CHARS
        ) {
          isTruncated = true

          break
        }

        lines.push(rendered)
        renderedResults += 1
        renderedChars += rendered.length
      }
    } else {
      const remainingChars = SEARCH_ANSWER_CONTEXT_MAX_CHARS - renderedChars
      const rendered = truncate(
        stringifyUnknown(searchResult.output),
        Math.min(SEARCH_ANSWER_OPAQUE_OUTPUT_MAX_CHARS, remainingChars),
      )

      if (remainingChars <= 0) {
        isTruncated = true

        break
      }

      lines.push(rendered)
      renderedChars += rendered.length
    }

    sections.push(lines.join('\n'))
  }

  if (isTruncated) {
    sections.push(SEARCH_ANSWER_OMITTED_NOTICE)
  }

  return [
    'Web search results gathered for this conversation:',
    ...sections,
  ].join('\n\n')
}

function withoutToolHistory(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  const toollessMessages: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'tool') {
      continue
    }

    if (message.role !== 'assistant' || typeof message.content === 'string') {
      toollessMessages.push(message)
      continue
    }

    const content = message.content.filter((part) => {
      return part.type !== 'tool-call'
        && part.type !== 'tool-result'
        && part.type !== 'tool-approval-request'
    })

    if (content.length > 0) {
      toollessMessages.push({ ...message, content })
    }
  }

  return toollessMessages
}

/**
 * The continuation's prompt: the turn's own model messages with any tool
 * history stripped (the continuation declares no tools, and Anthropic and
 * Gemini reject tool calls/results sent without declarations), plus the
 * flattened search results and the answer-now instruction appended as one
 * extra text part of the final user message. Appending to that message
 * instead of adding a second consecutive user turn keeps the roles strictly
 * alternating, which `@ai-sdk/google` would otherwise forward verbatim.
 */
export function buildSearchAnswerContinuationMessages(
  messages: readonly ModelMessage[],
  searchResults: readonly CollectedSearchResult[],
): ModelMessage[] {
  const contextText = [
    buildSearchResultsContext(searchResults),
    SEARCH_ANSWER_INSTRUCTIONS,
  ].join('\n\n')
  const toollessMessages = withoutToolHistory(messages)
  const lastMessage = toollessMessages.at(-1)

  if (lastMessage?.role !== 'user') {
    return [
      ...toollessMessages,
      { role: 'user', content: [{ type: 'text', text: contextText }] },
    ]
  }

  const existingContent = typeof lastMessage.content === 'string'
    ? [{ type: 'text' as const, text: lastMessage.content }]
    : lastMessage.content

  return [
    ...toollessMessages.slice(0, -1),
    {
      ...lastMessage,
      content: [...existingContent, { type: 'text', text: contextText }],
    },
  ]
}

function isVisibleTextDelta(chunk: UIMessageChunk): boolean {
  return chunk.type === 'text-delta' && chunk.delta.trim().length > 0
}

type FinishChunk = Extract<UIMessageChunk, { type: 'finish' }>
type ErrorChunk = Extract<UIMessageChunk, { type: 'error' }>

/**
 * Guarantees that a tool-loop turn whose follow-up tool ran still ends with
 * a visible answer. The loop's own UI stream passes through untouched except
 * for its `finish` chunk (held back) and an `error` raised on the forced
 * final step after a search already completed (also held back). When the
 * loop ends with no visible text, `startContinuation()` runs ONE tool-less
 * generation and its chunks stream into the same assistant message, after
 * the tool and source parts, followed by a single `finish` chunk whose
 * metadata comes from `buildFinishMessageMetadata()` so usage and cost cover
 * the continuation too. Errors on earlier steps and aborts keep the
 * existing error handling: no continuation runs for them.
 *
 * When the continuation also produces no text (or throws), the held error
 * and `finish` chunks are released as they were, so the persistence path's
 * empty-answer notice and live error chunk behave exactly as before. The
 * continuation's own `error` and `abort` chunks (its timeout aborts) are
 * never forwarded: an `abort` would make persistence drop the whole turn,
 * search results included.
 */
export function withSearchAnswerGuarantee(input: {
  stream: ReadableStream<UIMessageChunk>
  followUpToolNames: ReadonlySet<string>
  forcedStepIndex: number
  startContinuation: (
    searchResults: CollectedSearchResult[],
  ) => SearchAnswerContinuationRun
  buildFinishMessageMetadata: (
    continuation: SearchAnswerContinuationResult,
  ) => unknown
}): {
  stream: ReadableStream<UIMessageChunk>
  getOutcome: () => SearchAnswerOutcome
} {
  const outcome: SearchAnswerOutcome = {
    stepsCount: 0,
    forcedStepToolCall: false,
    continuationRan: false,
    continuationProducedText: false,
    continuationError: undefined,
    finishReason: undefined,
    continuation: undefined,
  }
  const toolNamesByCallId = new Map<string, string>()
  const searchResultsByCallId = new Map<string, CollectedSearchResult>()
  const heldErrors: ErrorChunk[] = []
  let heldFinish: FinishChunk | undefined
  let hasVisibleText = false
  let followUpToolOutputCount = 0
  let isAborted = false
  let hadUnrecoverableError = false

  function recordToolOutput(chunk: UIMessageChunk) {
    if (
      chunk.type !== 'tool-output-available'
      && chunk.type !== 'tool-output-error'
    ) {
      return
    }

    const toolName = toolNamesByCallId.get(chunk.toolCallId)

    if (!toolName || !input.followUpToolNames.has(toolName)) {
      return
    }

    followUpToolOutputCount += 1

    const searchResult = searchResultsByCallId.get(chunk.toolCallId)
      ?? { toolName, input: undefined }

    if (chunk.type === 'tool-output-available') {
      searchResult.output = chunk.output
    } else {
      searchResult.errorText = chunk.errorText
    }

    searchResultsByCallId.set(chunk.toolCallId, searchResult)
  }

  function recordToolCall(chunk: UIMessageChunk) {
    if (
      chunk.type !== 'tool-input-start'
      && chunk.type !== 'tool-input-available'
      && chunk.type !== 'tool-input-error'
    ) {
      return
    }

    if (outcome.stepsCount >= input.forcedStepIndex) {
      outcome.forcedStepToolCall = true
    }

    toolNamesByCallId.set(chunk.toolCallId, chunk.toolName)

    if (
      chunk.type === 'tool-input-available'
      && input.followUpToolNames.has(chunk.toolName)
    ) {
      searchResultsByCallId.set(chunk.toolCallId, {
        toolName: chunk.toolName,
        input: chunk.input,
      })
    }
  }

  function isForcedStepError(): boolean {
    return outcome.stepsCount >= input.forcedStepIndex
      && followUpToolOutputCount > 0
      && !hasVisibleText
  }

  function buildFinalFinishChunk(): FinishChunk | undefined {
    const continuation = outcome.continuation

    if (!continuation) {
      if (heldFinish) {
        return heldFinish
      }

      return outcome.continuationProducedText
        ? { type: 'finish' }
        : undefined
    }

    if (!heldFinish && !outcome.continuationProducedText) {
      return undefined
    }

    let messageMetadata = heldFinish?.messageMetadata

    try {
      messageMetadata = input.buildFinishMessageMetadata(continuation)
    } catch (exception) {
      outcome.continuationError = exceptionMessage(exception)
    }

    const finishReason = outcome.continuationProducedText
      ? continuation.finishReason ?? heldFinish?.finishReason
      : heldFinish?.finishReason ?? continuation.finishReason

    return {
      type: 'finish',
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(messageMetadata === undefined ? {} : { messageMetadata }),
    }
  }

  async function pumpContinuation(
    controller: TransformStreamDefaultController<UIMessageChunk>,
  ) {
    outcome.continuationRan = true

    try {
      const run = input.startContinuation([...searchResultsByCallId.values()])
      const reader = run.stream.getReader()

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        if (value.type === 'error') {
          outcome.continuationError = value.errorText

          continue
        }

        if (value.type === 'abort') {
          outcome.continuationError = value.reason ?? 'aborted'

          continue
        }

        if (isVisibleTextDelta(value)) {
          outcome.continuationProducedText = true
        }

        controller.enqueue(value)
      }

      outcome.continuation = await run.settle()
    } catch (exception) {
      outcome.continuationError = exceptionMessage(exception)
    }
  }

  const stream = input.stream.pipeThrough(new TransformStream<
    UIMessageChunk,
    UIMessageChunk
  >({
    transform(chunk, controller) {
      if (chunk.type === 'finish') {
        heldFinish = chunk

        return
      }

      if (chunk.type === 'error') {
        if (isForcedStepError()) {
          heldErrors.push(chunk)

          return
        }

        hadUnrecoverableError = true
      }

      if (chunk.type === 'abort') {
        isAborted = true
      }

      if (chunk.type === 'finish-step') {
        outcome.stepsCount += 1
      }

      if (isVisibleTextDelta(chunk)) {
        hasVisibleText = true
      }

      recordToolCall(chunk)
      recordToolOutput(chunk)
      controller.enqueue(chunk)
    },
    async flush(controller) {
      const shouldContinue = followUpToolOutputCount > 0
        && !hasVisibleText
        && !isAborted
        && !hadUnrecoverableError

      if (shouldContinue) {
        await pumpContinuation(controller)
      }

      if (!outcome.continuationProducedText) {
        for (const heldError of heldErrors) {
          controller.enqueue(heldError)
        }
      }

      const finishChunk = buildFinalFinishChunk()

      outcome.finishReason = finishChunk?.finishReason

      if (finishChunk) {
        controller.enqueue(finishChunk)
      }
    },
  }))

  return {
    stream,
    getOutcome: () => outcome,
  }
}
