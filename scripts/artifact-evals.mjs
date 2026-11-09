#!/usr/bin/env node

/**
 * Golden-prompt evals for artifacts (A-10). Sends each case in
 * tests/evals/artifacts/prompts.json through a running Besidka app (a PR
 * preview or a local server) as a dedicated test account, so the real send
 * path, tools, instructions and artifact store are exercised. Spend lands on
 * that account's own provider keys; never point it at a real user's account.
 *
 * Usage:
 *   ARTIFACT_EVALS_EMAIL=... ARTIFACT_EVALS_PASSWORD=... \
 *     node scripts/artifact-evals.mjs run \
 *       --base-url=https://pr-<n>-besidka.chernenko.workers.dev \
 *       --models=claude-haiku-5-5,gpt-6-luna,gemini-3.8-flash \
 *       [--cases=quiz-photosynthesis,edit-flow] [--out=.evals/artifacts]
 *       [--budget-usd=4] [--failed-case-estimate-usd=0.1]
 *
 *   node scripts/artifact-evals.mjs summary --dir=.evals/artifacts/<date>
 *   node scripts/artifact-evals.mjs rescore --dir=.evals/artifacts/<date>
 *
 * Results go to `.evals/artifacts/<date>/<model>/<case>.json` (gitignored).
 * The behavioural checks (`interactive`) run in the opt-in Playwright spec
 * tests/e2e/artifacts/evals-render.spec.ts against the same results.
 * See docs/artifacts.md "Evals".
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PROMPTS_PATH = 'tests/evals/artifacts/prompts.json'
export const DEFAULT_OUTPUT_DIR = '.evals/artifacts'
export const ARTIFACT_SIZE_LIMIT_BYTES = 512 * 1024
export const ARTIFACT_KINDS = ['html', 'react', 'svg', 'mermaid', 'markdown']
export const STATIC_CHECKS = [
  'artifact',
  'no-artifact',
  'kind',
  'size',
  'no-network',
  'no-navigation',
  'storage',
  'bridge',
  'timer',
  'cyrillic',
  'edits',
  'inline-mermaid',
  'inline-code',
  'no-source-echo',
]
export const BEHAVIOURAL_CHECKS = ['interactive']
export const KNOWN_CHECKS = [...STATIC_CHECKS, ...BEHAVIOURAL_CHECKS]

const SEND_TIMEOUT_MS = 240_000
const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnew\s+WebSocket\s*\(/,
  /\bnew\s+EventSource\s*\(/,
  /\bsendBeacon\s*\(/,
  /\bimport\s*\(\s*['"`]https?:/,
  /\bfrom\s+['"`]https?:/,
  /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*['"]https?:/i,
  /@import\s+(?:url\()?['"]?https?:/i,
]
const NAVIGATION_PATTERNS = [
  /(?<!\b(?:const|let|var)\s+)\blocation(?:\.href)?\s*=(?!=)/,
  /\blocation\.(?:assign|replace)\s*\(/,
  /\bwindow\.open\s*\(/,
  /<form\b[^>]*\baction\s*=\s*['"]https?:/i,
]
const STORAGE_PATTERN = /\bbesidka\.storage\.(?:set|get)\s*\(/
const BRIDGE_PATTERN = /\bbesidka\.complete\s*\(/
const TIMER_PATTERN = /\bset(?:Interval|Timeout)\s*\(/
const CYRILLIC_PATTERN = /[Ѐ-ӿ]/
const FENCED_BLOCK_PATTERN = /```[^\n`]*\n[\s\S]*?```/g
const FENCED_MERMAID_PATTERN = /```mermaid[ \t]*\n[\s\S]*?```/
const UNFENCED_SOURCE_PATTERNS = [
  /^\s*(?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)\b/m,
  /^\s*(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|gitGraph)\s*$/m,
  /^\s*\w+(?:[[({][^\n]*[\])}])?\s*-->/m,
  /<!DOCTYPE html|<html\b/i,
  /^\s*import\s[^\n]*\sfrom\s+['"][^'"]+['"]/m,
  /^\s*export\s+default\s+function\b/m,
  /^#!\/(?:usr\/)?bin\//m,
]
const ECHO_LINE_MIN_LENGTH = 16
const ECHO_LINES_MAX = 2

/**
 * Returns a list of human-readable problems with a parsed prompts file; an
 * empty list means the file is valid.
 */
export function validateEvalCases(data) {
  const problems = []

  if (!data || typeof data !== 'object' || !Array.isArray(data.cases)) {
    return ['The file must be an object with a "cases" array.']
  }

  const seenIds = new Set()

  data.cases.forEach((evalCase, index) => {
    const label = `cases[${index}]`

    if (typeof evalCase?.id !== 'string' || !/^[a-z0-9-]+$/.test(evalCase.id)) {
      problems.push(`${label}: id must be lowercase letters, digits and -`)
    } else if (seenIds.has(evalCase.id)) {
      problems.push(`${label}: duplicate id ${evalCase.id}`)
    } else {
      seenIds.add(evalCase.id)
    }

    if (typeof evalCase?.prompt !== 'string' || !evalCase.prompt.trim()) {
      problems.push(`${label}: prompt must be a non-empty string`)
    }

    if (
      !Array.isArray(evalCase?.expectedKind)
      || evalCase.expectedKind.some(kind => !ARTIFACT_KINDS.includes(kind))
    ) {
      problems.push(`${label}: expectedKind must list artifact kinds`)
    }

    if (
      !Array.isArray(evalCase?.checks)
      || !evalCase.checks.length
      || evalCase.checks.some(check => !KNOWN_CHECKS.includes(check))
    ) {
      problems.push(`${label}: checks must list known checks`)
    }

    const followUp = evalCase?.followUp

    if (followUp !== undefined && typeof followUp !== 'string') {
      problems.push(`${label}: followUp must be a string`)
    }

    const wantsArtifact = evalCase?.checks?.includes('artifact')
    const wantsNone = evalCase?.checks?.includes('no-artifact')

    if (wantsArtifact && wantsNone) {
      problems.push(`${label}: artifact and no-artifact exclude each other`)
    }

    if (wantsNone && evalCase.expectedKind?.length) {
      problems.push(`${label}: a no-artifact case expects no kind`)
    }
  })

  return problems
}

export function loadEvalCases(path = DEFAULT_PROMPTS_PATH) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const problems = validateEvalCases(data)

  if (problems.length) {
    throw new Error(`Invalid eval prompts:\n${problems.join('\n')}`)
  }

  return data.cases
}

export function matchesAny(patterns, content) {
  return patterns.some((pattern) => {
    return pattern.test(content)
  })
}

/**
 * Scores the checks that need no browser. `observation` holds the artifact
 * writes seen in the stream (`writes`: `{ toolName, input, error }`) and the
 * final contents (`artifacts`: `{ kind, content }`). Behavioural checks are
 * left as `pending` for the render spec.
 */
export function scoreStaticChecks(evalCase, observation) {
  const artifacts = observation.artifacts ?? []
  const writes = observation.writes ?? []
  const failedWrites = writes.filter(write => write.error)
  const contents = artifacts.map(artifact => artifact.content ?? '').join('\n')
  const replyText = observation.replyText
  const results = {}

  for (const check of evalCase.checks) {
    if (BEHAVIOURAL_CHECKS.includes(check)) {
      results[check] = { status: 'pending' }

      continue
    }

    results[check] = scoreStaticCheck(check, {
      evalCase,
      artifacts,
      writes,
      failedWrites,
      contents,
      replyText,
    })
  }

  return results
}

/**
 * Lines of artifact content (at least `ECHO_LINE_MIN_LENGTH` characters
 * once trimmed) that the reply repeats verbatim, fenced or not.
 */
export function findEchoedSourceLines(artifacts, replyText) {
  const replyLines = new Set(replyText.split('\n').map(line => line.trim()))
  const echoed = new Set()

  for (const artifact of artifacts) {
    for (const line of (artifact.content ?? '').split('\n')) {
      const trimmed = line.trim()

      if (trimmed.length >= ECHO_LINE_MIN_LENGTH && replyLines.has(trimmed)) {
        echoed.add(trimmed)
      }
    }
  }

  return [...echoed]
}

/**
 * Fails a reply that prints diagram or code source outside a fenced block,
 * or repeats more than `ECHO_LINES_MAX` lines of an artifact it wrote.
 */
export function scoreSourceEcho(artifacts, replyText) {
  const unfenced = replyText.replace(FENCED_BLOCK_PATTERN, '')

  if (matchesAny(UNFENCED_SOURCE_PATTERNS, unfenced)) {
    return { pass: false, note: 'source outside a fenced block' }
  }

  const echoed = findEchoedSourceLines(artifacts, replyText)

  if (echoed.length > ECHO_LINES_MAX) {
    return {
      pass: false,
      note: `${echoed.length} artifact lines repeated in the reply`,
    }
  }

  return { pass: true, note: '' }
}

function scoreStaticCheck(check, context) {
  const {
    evalCase,
    artifacts,
    writes,
    failedWrites,
    contents,
    replyText,
  } = context
  const verdict = (pass, note) => {
    return { status: pass ? 'pass' : 'fail', ...(note ? { note } : {}) }
  }
  const textChecks = ['inline-mermaid', 'inline-code', 'no-source-echo']

  if (textChecks.includes(check) && typeof replyText !== 'string') {
    return { status: 'skipped', note: 'no reply text stored' }
  }

  switch (check) {
    case 'artifact':
      return verdict(
        artifacts.length > 0,
        failedWrites.length
          ? `${failedWrites.length} failed write(s): ${failedWrites[0].error}`
          : artifacts.length ? '' : 'no artifact was created',
      )
    case 'no-artifact':
      return verdict(writes.length === 0, writes.length
        ? `${writes.length} artifact write(s)`
        : '')
    case 'kind': {
      const kinds = artifacts.map(artifact => artifact.kind)

      return verdict(
        kinds.length > 0 && kinds.every((kind) => {
          return evalCase.expectedKind.includes(kind)
        }),
        kinds.join(','),
      )
    }
    case 'size': {
      const largest = Math.max(0, ...artifacts.map((artifact) => {
        return Buffer.byteLength(artifact.content ?? '', 'utf8')
      }))

      return verdict(
        artifacts.length > 0 && largest <= ARTIFACT_SIZE_LIMIT_BYTES,
        `${largest} bytes`,
      )
    }
    case 'no-network':
      return verdict(
        artifacts.length > 0 && !matchesAny(NETWORK_PATTERNS, contents),
      )
    case 'no-navigation':
      return verdict(
        artifacts.length > 0 && !matchesAny(NAVIGATION_PATTERNS, contents),
      )
    case 'storage':
      return verdict(STORAGE_PATTERN.test(contents))
    case 'bridge':
      return verdict(BRIDGE_PATTERN.test(contents))
    case 'timer':
      return verdict(TIMER_PATTERN.test(contents))
    case 'cyrillic':
      return verdict(CYRILLIC_PATTERN.test(contents))
    case 'edits': {
      const update = writes.find((write) => {
        return write.toolName === 'update_artifact' && !write.error
      })

      if (!update) {
        return verdict(false, 'no update_artifact call')
      }

      const usedEdits = update.input
        ? Array.isArray(update.input.edits)
        && update.input.content === undefined
        : update.mode === 'edits'

      return verdict(usedEdits, usedEdits
        ? `${update.input?.edits?.length ?? (update.edits || 'some')} edit(s)`
        : 'full content resent')
    }
    case 'inline-mermaid':
      return verdict(
        FENCED_MERMAID_PATTERN.test(replyText),
        FENCED_MERMAID_PATTERN.test(replyText) ? '' : 'no ```mermaid block',
      )
    case 'inline-code': {
      const blocks = replyText.match(FENCED_BLOCK_PATTERN) ?? []

      return verdict(blocks.length > 0, `${blocks.length} fenced block(s)`)
    }
    case 'no-source-echo': {
      const echo = scoreSourceEcho(artifacts, replyText)

      return verdict(echo.pass, echo.note)
    }
    default:
      return { status: 'skipped', note: `unknown check ${check}` }
  }
}

/**
 * Recomputes the static checks of a stored result (after a check changed)
 * and keeps a behavioural result the render spec already wrote.
 */
export function rescoreResult(evalCase, result) {
  const checks = scoreStaticChecks(evalCase, {
    writes: result.writes ?? [],
    artifacts: result.artifacts ?? [],
    replyText: result.replyText,
  })

  for (const check of BEHAVIOURAL_CHECKS) {
    if (checks[check] && result.checks?.[check]) {
      checks[check] = result.checks[check]
    }
  }

  return { ...result, checks, status: summariseCheckStatus(checks) }
}

export function summariseCheckStatus(checks) {
  const statuses = Object.values(checks).map(check => check.status)

  if (statuses.includes('fail')) {
    return 'fail'
  }

  if (statuses.includes('pending')) {
    return 'pending'
  }

  return 'pass'
}

/**
 * Sums the cost of the assistant messages of an eval chat, in USD. A
 * blended `totalCost` (gateway sends) wins over the input/output split, the
 * same rule as the message cost row.
 */
export function computeUsageCost(usages) {
  let cost = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const usage of usages) {
    if (!usage) {
      continue
    }

    inputTokens += usage.inputTokens ?? 0
    outputTokens += usage.outputTokens ?? 0

    cost += typeof usage.totalCost === 'number'
      ? usage.totalCost
      : (usage.inputCost ?? 0) + (usage.outputCost ?? 0)
    cost += usage.searchCost ?? 0
  }

  return {
    costUsd: Math.round(cost * 1_000_000) / 1_000_000,
    inputTokens,
    outputTokens,
  }
}

export function findStreamError(streamText) {
  for (const line of streamText.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue
    }

    try {
      const event = JSON.parse(line.slice(6))

      if (event?.type === 'error') {
        return String(event.errorText ?? 'stream error')
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Reads the AI SDK UI message stream (server-sent events) and returns the
 * artifact tool calls with their inputs and outcomes, including calls whose
 * input the SDK rejected (`tool-input-error`).
 */
export function parseArtifactWrites(streamText) {
  const calls = new Map()

  for (const line of streamText.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue
    }

    let event

    try {
      event = JSON.parse(line.slice(6))
    } catch {
      continue
    }

    if (!event || typeof event !== 'object' || !event.toolCallId) {
      continue
    }

    const existing = calls.get(event.toolCallId) ?? {}

    if (event.type === 'tool-input-available') {
      calls.set(event.toolCallId, {
        ...existing,
        toolName: event.toolName,
        input: event.input,
      })
    } else if (event.type === 'tool-input-error') {
      calls.set(event.toolCallId, {
        ...existing,
        toolName: event.toolName,
        input: event.input,
        error: event.errorText,
      })
    } else if (event.type === 'tool-output-available') {
      calls.set(event.toolCallId, { ...existing, output: event.output })
    } else if (event.type === 'tool-output-error') {
      calls.set(event.toolCallId, { ...existing, error: event.errorText })
    }
  }

  return [...calls.values()].filter((call) => {
    return call.toolName === 'create_artifact'
      || call.toolName === 'update_artifact'
  })
}

export function resultPath(rootDir, model, caseId) {
  return join(rootDir, model.replace(/[^a-z0-9._-]/gi, '_'), `${caseId}.json`)
}

export function writeEvalResult(rootDir, result) {
  const path = resultPath(rootDir, result.model, result.caseId)

  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)

  return path
}

export function readEvalResults(rootDir) {
  const results = []

  for (const modelDir of readdirSync(rootDir, { withFileTypes: true })) {
    if (!modelDir.isDirectory()) {
      continue
    }

    for (const file of readdirSync(join(rootDir, modelDir.name))) {
      if (file.endsWith('.json')) {
        results.push(JSON.parse(
          readFileSync(join(rootDir, modelDir.name, file), 'utf8'),
        ))
      }
    }
  }

  return results
}

function median(values) {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/**
 * One Markdown table row per model: passed cases, median output tokens and
 * total cost, plus one row per case with the per-model status.
 */
export function summariseResults(results) {
  const models = [...new Set(results.map(result => result.model))].sort()
  const caseIds = [...new Set(results.map(result => result.caseId))]
  const byKey = new Map(results.map((result) => {
    return [`${result.model}|${result.caseId}`, result]
  }))
  const lines = [
    `| Case | ${models.join(' | ')} |`,
    `| --- | ${models.map(() => '---').join(' | ')} |`,
  ]

  for (const caseId of caseIds) {
    const cells = models.map((model) => {
      const result = byKey.get(`${model}|${caseId}`)

      if (!result) {
        return '-'
      }

      return `${result.status} $${result.usage.costUsd.toFixed(4)}`
    })

    lines.push(`| ${caseId} | ${cells.join(' | ')} |`)
  }

  const totals = models.map((model) => {
    const modelResults = results.filter(result => result.model === model)
    const passed = modelResults.filter(result => result.status === 'pass')
    const cost = modelResults.reduce((sum, result) => {
      return sum + result.usage.costUsd
    }, 0)
    const outputTokens = median(modelResults.map((result) => {
      return result.usage.outputTokens
    }))

    return `${passed.length}/${modelResults.length}, `
      + `median out ${outputTokens}, $${cost.toFixed(4)}`
  })

  lines.push(`| **Total** | ${totals.join(' | ')} |`)

  return lines.join('\n')
}

export function parseCliArguments(argumentList) {
  const [command, ...rest] = argumentList
  const options = {}

  for (const argument of rest) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argument)

    if (match) {
      options[match[1]] = match[2]
    }
  }

  return { command, options }
}

class SessionClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.cookies = new Map()
  }

  async request(path, init = {}) {
    const headers = {
      origin: this.baseUrl,
      cookie: [...this.cookies].map(([name, value]) => {
        return `${name}=${value}`
      }).join('; '),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
    })

    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';')
      const separator = pair.indexOf('=')

      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }

    return response
  }

  async json(path, init) {
    const response = await this.request(path, init)

    if (!response.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} `
        + `${(await response.text()).slice(0, 300)}`)
    }

    return response.json()
  }
}

async function sendTurn(client, slug, model, message) {
  const response = await client.request(`/api/v1/chats/${slug}`, {
    method: 'POST',
    body: { model, tools: [], reasoning: 'off', messages: [message] },
    timeoutMs: SEND_TIMEOUT_MS,
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`send ${response.status}: ${text.slice(0, 300)}`)
  }

  return text
}

export const DEFAULT_FAILED_CASE_ESTIMATE_USD = 0.1

export function isValidUsdAmount(value) {
  return Number.isFinite(value) && value >= 0
}

/**
 * Tags an error thrown after the eval chat exists with that chat, so the
 * run can still count what the provider billed before the failure.
 */
export function attachChatToError(exception, chatSlug, sendStarted) {
  const error = exception instanceof Error
    ? exception
    : new Error(String(exception))

  error.chatSlug = chatSlug
  error.sendStarted = sendStarted

  return error
}

/**
 * The cost of a case that threw. Before the chat exists nothing was billed.
 * Otherwise the chat's assistant messages are summed; when they cannot be
 * read, or a send started but no cost was recorded yet (a timed-out
 * generation keeps running on the server), the pessimistic estimate is
 * charged so `--budget-usd` still holds.
 */
export async function recoverFailedCaseUsage(
  fetchChat,
  exception,
  estimateUsd = DEFAULT_FAILED_CASE_ESTIMATE_USD,
) {
  const empty = { costUsd: 0, inputTokens: 0, outputTokens: 0 }
  const chatSlug = exception?.chatSlug

  if (!chatSlug) {
    return { ...empty, estimated: false }
  }

  try {
    const chat = await fetchChat(chatSlug)
    const usage = computeUsageCost((chat?.messages ?? [])
      .filter(message => message.role === 'assistant')
      .map(message => message.usage))

    if (exception.sendStarted && usage.costUsd === 0) {
      return { ...usage, costUsd: estimateUsd, estimated: true }
    }

    return { ...usage, estimated: false }
  } catch {
    return { ...empty, costUsd: estimateUsd, estimated: true }
  }
}

/**
 * The text the user sees from every assistant message of the chat, both
 * turns of a follow-up case included, without reasoning or tool parts.
 */
export function readReplyText(messages) {
  return (messages ?? [])
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.parts ?? [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n\n')
}

async function runCase(client, evalCase, model) {
  const created = await client.json('/api/v1/chats/new', {
    method: 'PUT',
    body: {
      parts: [{ type: 'text', text: evalCase.prompt }],
      tools: [],
      reasoning: 'off',
      model,
      memoryExcluded: true,
    },
  })
  const progress = { sendStarted: false }

  try {
    return await runCreatedCase(client, evalCase, model, created, progress)
  } catch (exception) {
    throw attachChatToError(exception, created.slug, progress.sendStarted)
  }
}

async function runCreatedCase(client, evalCase, model, created, progress) {
  const startedAt = Date.now()
  const chat = await client.json(`/api/v1/chats/${created.slug}`)
  const firstMessage = chat.messages.find(message => message.role === 'user')
  progress.sendStarted = true

  let stream = await sendTurn(client, created.slug, model, {
    id: firstMessage.id,
    role: 'user',
    parts: firstMessage.parts,
  })

  if (evalCase.followUp) {
    stream += await sendTurn(client, created.slug, model, {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: evalCase.followUp }],
    })
  }

  const streamError = findStreamError(stream)

  if (streamError) {
    throw new Error(`stream error: ${streamError}`)
  }

  const writes = parseArtifactWrites(stream)
  const finalChat = await client.json(`/api/v1/chats/${created.slug}`)
  const latestByArtifact = new Map()

  for (const write of writes) {
    if (write.output?.artifactId) {
      latestByArtifact.set(write.output.artifactId, write.output)
    }
  }

  const artifacts = []

  for (const output of latestByArtifact.values()) {
    const version = await client.json(
      `/api/v1/artifacts/${output.artifactId}/versions/${output.version}`,
    )

    artifacts.push({
      artifactId: output.artifactId,
      version: output.version,
      kind: version.kind ?? output.kind,
      title: version.title ?? output.title,
      content: version.content,
    })
  }

  const replyText = readReplyText(finalChat.messages)
  const checks = scoreStaticChecks(evalCase, { writes, artifacts, replyText })
  const usage = computeUsageCost(finalChat.messages
    .filter(message => message.role === 'assistant')
    .map(message => message.usage))

  return {
    caseId: evalCase.id,
    model,
    chatSlug: created.slug,
    durationMs: Date.now() - startedAt,
    writes: writes.map(write => ({
      toolName: write.toolName,
      mode: write.input?.edits ? 'edits' : 'content',
      edits: write.input?.edits?.length ?? 0,
      error: write.error ?? null,
    })),
    artifacts,
    replyText,
    checks,
    status: summariseCheckStatus(checks),
    usage,
  }
}

async function runCommand(options) {
  const email = process.env.ARTIFACT_EVALS_EMAIL
  const password = process.env.ARTIFACT_EVALS_PASSWORD

  if (!options['base-url'] || !options.models || !email || !password) {
    console.error('Need --base-url, --models and ARTIFACT_EVALS_EMAIL/'
      + 'ARTIFACT_EVALS_PASSWORD (a dedicated test account).')
    process.exit(1)
  }

  const cases = loadEvalCases(options.prompts ?? DEFAULT_PROMPTS_PATH)
  const wantedCases = options.cases ? options.cases.split(',') : null
  const selectedCases = wantedCases
    ? cases.filter(evalCase => wantedCases.includes(evalCase.id))
    : cases
  const date = new Date().toISOString().slice(0, 10)
  const rootDir = resolve(options.out ?? DEFAULT_OUTPUT_DIR, date)
  const budgetUsd = Number(options['budget-usd'] ?? 4)
  const failedCaseEstimateUsd = Number(
    options['failed-case-estimate-usd'] ?? DEFAULT_FAILED_CASE_ESTIMATE_USD,
  )

  const amounts = [budgetUsd, failedCaseEstimateUsd]

  if (!amounts.every(isValidUsdAmount)) {
    console.error('--budget-usd and --failed-case-estimate-usd must be '
      + 'numbers of 0 or more.')
    process.exit(1)
  }
  const client = new SessionClient(options['base-url'])
  let spentUsd = 0

  await client.json('/api/auth/sign-in/email', {
    method: 'POST',
    body: { email, password },
  })

  for (const model of options.models.split(',')) {
    for (const evalCase of selectedCases) {
      if (spentUsd >= budgetUsd) {
        console.log(`Budget of $${budgetUsd} reached, stopping.`)

        return
      }

      try {
        const result = await runCase(client, evalCase, model)

        spentUsd += result.usage.costUsd
        writeEvalResult(rootDir, result)
        console.log(`${model} ${evalCase.id}: ${result.status} `
          + `$${result.usage.costUsd.toFixed(4)} `
          + `(${result.usage.outputTokens} out, ${result.durationMs} ms)`)
      } catch (exception) {
        const usage = await recoverFailedCaseUsage((slug) => {
          return client.json(`/api/v1/chats/${slug}`)
        }, exception, failedCaseEstimateUsd)
        const estimateNote = usage.estimated ? ' (estimate)' : ''

        spentUsd += usage.costUsd
        writeEvalResult(rootDir, {
          caseId: evalCase.id,
          model,
          chatSlug: exception?.chatSlug ?? null,
          status: 'error',
          error: exception instanceof Error
            ? exception.message
            : String(exception),
          checks: {},
          usage,
        })
        console.log(`${model} ${evalCase.id}: error ${exception} `
          + `$${usage.costUsd.toFixed(4)}${estimateNote}`)
      }
    }
  }

  console.log(`\nSpent about $${spentUsd.toFixed(4)}. Results: ${rootDir}`)
}

async function main() {
  const { command, options } = parseCliArguments(process.argv.slice(2))

  if (command === 'run') {
    await runCommand(options)

    return
  }

  if (command === 'rescore') {
    const rootDir = resolve(options.dir)
    const cases = loadEvalCases(options.prompts ?? DEFAULT_PROMPTS_PATH)

    for (const result of readEvalResults(rootDir)) {
      const evalCase = cases.find(candidate => candidate.id === result.caseId)

      if (!evalCase || result.status === 'error') {
        continue
      }

      writeEvalResult(rootDir, rescoreResult(evalCase, result))
    }

    console.log(summariseResults(readEvalResults(rootDir)))

    return
  }

  if (command === 'summary') {
    console.log(summariseResults(readEvalResults(resolve(options.dir))))

    return
  }

  console.error('Usage: node scripts/artifact-evals.mjs run|summary|rescore '
    + '[options]')
  process.exit(1)
}

const isEntryPoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
  await main()
}
