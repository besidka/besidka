import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAILED_CASE_ESTIMATE_USD,
  DEFAULT_PROMPTS_PATH,
  attachChatToError,
  computeUsageCost,
  describeTimedOutRequest,
  isRequestTimeout,
  isValidUsdAmount,
  recoverFailedCaseUsage,
  findStreamError,
  loadEvalCases,
  parseArtifactWrites,
  parseCliArguments,
  readEvalResults,
  retryStalledRead,
  SessionClient,
  rescoreResult,
  scoreStaticChecks,
  summariseCheckStatus,
  summariseResults,
  validateEvalCases,
  writeEvalResult,
} from '../../../scripts/artifact-evals.mjs'

const QUIZ_CASE = {
  id: 'quiz',
  prompt: 'Make a quiz',
  expectedKind: ['html', 'react'],
  checks: ['artifact', 'kind', 'size', 'no-network', 'interactive'],
}

function streamOf(events: Record<string, unknown>[]): string {
  return events.map((event) => {
    return `data: ${JSON.stringify(event)}\n\n`
  }).join('') + 'data: [DONE]\n\n'
}

describe('prompts file', () => {
  it('loads the committed golden prompts', () => {
    const cases = loadEvalCases(DEFAULT_PROMPTS_PATH)

    expect(cases.length).toBeGreaterThanOrEqual(10)
    expect(cases.length).toBeLessThanOrEqual(14)
    expect(cases.some(evalCase => evalCase.checks.includes('no-artifact')))
      .toBe(true)
    expect(cases.some(evalCase => evalCase.checks.includes('no-navigation')))
      .toBe(true)
    expect(cases.some(evalCase => evalCase.followUp)).toBe(true)
  })

  it('reports schema problems', () => {
    expect(validateEvalCases({})).toEqual([
      'The file must be an object with a "cases" array.',
    ])
    expect(validateEvalCases({
      cases: [
        { ...QUIZ_CASE },
        { ...QUIZ_CASE },
        {
          id: 'Bad Id',
          prompt: '',
          expectedKind: ['pdf'],
          checks: ['magic'],
        },
        {
          id: 'both',
          prompt: 'x',
          expectedKind: ['html'],
          checks: ['artifact', 'no-artifact'],
        },
      ],
    })).toEqual([
      'cases[1]: duplicate id quiz',
      'cases[2]: id must be lowercase letters, digits and -',
      'cases[2]: prompt must be a non-empty string',
      'cases[2]: expectedKind must list artifact kinds',
      'cases[2]: checks must list known checks',
      'cases[3]: artifact and no-artifact exclude each other',
      'cases[3]: a no-artifact case expects no kind',
    ])
  })
})

describe('static checks', () => {
  it('passes a clean quiz and leaves the behavioural check pending', () => {
    const checks = scoreStaticChecks(QUIZ_CASE, {
      writes: [{ toolName: 'create_artifact', input: { content: 'x' } }],
      artifacts: [{
        kind: 'html',
        content: '<button onclick="score++">A</button>',
      }],
    })

    expect(checks.artifact.status).toBe('pass')
    expect(checks.kind).toEqual({ status: 'pass', note: 'html' })
    expect(checks['no-network'].status).toBe('pass')
    expect(checks.interactive.status).toBe('pending')
    expect(summariseCheckStatus(checks)).toBe('pending')
  })

  it('fails network, navigation and wrong kinds', () => {
    const checks = scoreStaticChecks({
      ...QUIZ_CASE,
      checks: ['artifact', 'kind', 'no-network', 'no-navigation'],
    }, {
      writes: [{ toolName: 'create_artifact', input: {} }],
      artifacts: [{
        kind: 'svg',
        content: 'await fetch("https://opentdb.com/api.php");'
          + ' window.open("https://opentdb.com")',
      }],
    })

    expect(checks.kind.status).toBe('fail')
    expect(checks['no-network'].status).toBe('fail')
    expect(checks['no-navigation'].status).toBe('fail')
    expect(summariseCheckStatus(checks)).toBe('fail')
  })

  it('scores edits, storage, bridge, timer and Cyrillic', () => {
    const checks = scoreStaticChecks({
      ...QUIZ_CASE,
      checks: ['edits', 'storage', 'bridge', 'timer', 'cyrillic'],
    }, {
      writes: [
        { toolName: 'create_artifact', input: { content: 'a' } },
        {
          toolName: 'update_artifact',
          input: { edits: [{ old_string: 'a', new_string: 'b' }] },
        },
      ],
      artifacts: [{
        kind: 'html',
        content: 'besidka.storage.set("k", 1); besidka.complete("p");'
          + ' setInterval(tick, 1000); "Київ"',
      }],
    })

    expect(Object.values(checks).every(check => check.status === 'pass'))
      .toBe(true)
    expect(checks.edits.note).toBe('1 edit(s)')
  })

  it('does not treat a variable named location as navigation', () => {
    const checks = scoreStaticChecks({
      ...QUIZ_CASE,
      checks: ['no-navigation'],
    }, {
      writes: [],
      artifacts: [{ kind: 'html', content: 'const location = "Kyiv"' }],
    })

    expect(checks['no-navigation'].status).toBe('pass')
    expect(scoreStaticChecks({ ...QUIZ_CASE, checks: ['no-navigation'] }, {
      writes: [],
      artifacts: [{ kind: 'html', content: 'window.location.href = "/x"' }],
    })['no-navigation'].status).toBe('fail')
  })

  it('fails edits when the model resends the whole content', () => {
    const checks = scoreStaticChecks({ ...QUIZ_CASE, checks: ['edits'] }, {
      writes: [{ toolName: 'update_artifact', input: { content: 'all' } }],
      artifacts: [{ kind: 'html', content: 'all' }],
    })

    expect(checks.edits).toEqual({
      status: 'fail',
      note: 'full content resent',
    })
  })

  it('passes a no-artifact case only without writes', () => {
    const noArtifactCase = {
      ...QUIZ_CASE,
      expectedKind: [],
      checks: ['no-artifact'],
    }

    expect(scoreStaticChecks(noArtifactCase, { writes: [], artifacts: [] }))
      .toEqual({ 'no-artifact': { status: 'pass' } })
    expect(scoreStaticChecks(noArtifactCase, {
      writes: [{ toolName: 'create_artifact', input: {} }],
      artifacts: [],
    })['no-artifact'].status).toBe('fail')
  })
})

describe('rescoring', () => {
  it('recomputes static checks from stored writes and keeps render results',
    () => {
      const rescored = rescoreResult({
        ...QUIZ_CASE,
        checks: ['artifact', 'edits', 'no-navigation', 'interactive'],
      }, {
        status: 'fail',
        writes: [
          { toolName: 'create_artifact', mode: 'content', error: null },
          { toolName: 'update_artifact', mode: 'edits', error: null },
        ],
        artifacts: [{
          kind: 'html',
          content: '<a href="https://example.com" target="_blank">More</a>',
        }],
        checks: { interactive: { status: 'pass', note: 'clicked' } },
      })

      expect(rescored.checks['no-navigation'].status).toBe('pass')
      expect(rescored.checks.edits.status).toBe('pass')
      expect(rescored.checks.interactive).toEqual({
        status: 'pass',
        note: 'clicked',
      })
      expect(rescored.status).toBe('pass')
    })
})

describe('stream parsing', () => {
  it('collects artifact tool calls with outputs and errors', () => {
    const writes = parseArtifactWrites(streamOf([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'one',
        toolName: 'create_artifact',
        input: { kind: 'html' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'one',
        output: { artifactId: 'A1', version: 1 },
      },
      {
        type: 'tool-input-available',
        toolCallId: 'two',
        toolName: 'update_artifact',
        input: { edits: [] },
      },
      { type: 'tool-output-error', toolCallId: 'two', errorText: 'Nope' },
      {
        type: 'tool-input-available',
        toolCallId: 'three',
        toolName: 'web_search',
        input: {},
      },
    ]))

    expect(writes).toEqual([
      {
        toolName: 'create_artifact',
        input: { kind: 'html' },
        output: { artifactId: 'A1', version: 1 },
      },
      { toolName: 'update_artifact', input: { edits: [] }, error: 'Nope' },
    ])
  })

  it('keeps calls whose input the SDK rejected', () => {
    expect(parseArtifactWrites(streamOf([{
      type: 'tool-input-error',
      toolCallId: 'bad',
      toolName: 'create_artifact',
      input: { kind: 'pdf' },
      errorText: 'Invalid input',
    }]))).toEqual([{
      toolName: 'create_artifact',
      input: { kind: 'pdf' },
      error: 'Invalid input',
    }])
  })

  it('finds a stream error chunk', () => {
    expect(findStreamError(streamOf([{ type: 'start' }]))).toBeNull()
    expect(findStreamError(streamOf([
      { type: 'error', errorText: 'Provider failed' },
    ]))).toBe('Provider failed')
  })
})

describe('cost math', () => {
  it('sums split, blended and search costs', () => {
    expect(computeUsageCost([
      {
        inputTokens: 1000,
        outputTokens: 500,
        inputCost: 0.001,
        outputCost: 0.002,
      },
      { inputTokens: 10, outputTokens: 5, totalCost: 0.01, inputCost: 9 },
      { inputTokens: 0, outputTokens: 0, searchCost: 0.014 },
      null,
    ])).toEqual({ costUsd: 0.027, inputTokens: 1010, outputTokens: 505 })
  })
})

describe('result files', () => {
  let directory = ''

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('writes, reads back and summarises results', () => {
    directory = mkdtempSync(join(tmpdir(), 'artifact-evals-'))

    const base = {
      checks: {},
      usage: { costUsd: 0.01, inputTokens: 100, outputTokens: 40 },
    }
    const path = writeEvalResult(directory, {
      ...base,
      caseId: 'quiz',
      model: 'model/a',
      status: 'pass',
    })

    writeEvalResult(directory, {
      ...base,
      caseId: 'quiz',
      model: 'model-b',
      status: 'fail',
    })

    expect(path).toBe(join(directory, 'model_a', 'quiz.json'))
    expect(JSON.parse(readFileSync(path, 'utf8')).status).toBe('pass')
    expect(readEvalResults(directory)).toHaveLength(2)
    expect(summariseResults(readEvalResults(directory))).toBe([
      '| Case | model-b | model/a |',
      '| --- | --- | --- |',
      '| quiz | fail $0.0100 | pass $0.0100 |',
      '| **Total** | 0/1, median out 40, $0.0100 '
      + '| 1/1, median out 40, $0.0100 |',
    ].join('\n'))
  })

  it('parses CLI options', () => {
    expect(parseCliArguments(['run', '--models=a,b', '--base-url=http://x']))
      .toEqual({
        command: 'run',
        options: { 'models': 'a,b', 'base-url': 'http://x' },
      })
  })
})

describe('failed case cost', () => {
  it('accepts only finite, non-negative dollar amounts', () => {
    expect(isValidUsdAmount(0)).toBe(true)
    expect(isValidUsdAmount(2.5)).toBe(true)
    expect(isValidUsdAmount(Number('abc'))).toBe(false)
    expect(isValidUsdAmount(-1)).toBe(false)
    expect(isValidUsdAmount(Infinity)).toBe(false)
  })

  const billedChat = {
    messages: [
      { role: 'user', usage: null },
      {
        role: 'assistant',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          inputCost: 0.01,
          outputCost: 0.02,
        },
      },
    ],
  }

  it('charges nothing when the chat was never created', async () => {
    const usage = await recoverFailedCaseUsage(async () => {
      throw new Error('not called')
    }, new Error('create failed'))

    expect(usage).toEqual({
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimated: false,
    })
  })

  it('charges what the chat recorded before the failure', async () => {
    const error = attachChatToError(new Error('stream error'), 'chat-1', true)
    const usage = await recoverFailedCaseUsage(async (slug) => {
      expect(slug).toBe('chat-1')

      return billedChat
    }, error)

    expect(usage).toEqual({
      costUsd: 0.03,
      inputTokens: 100,
      outputTokens: 50,
      estimated: false,
    })
  })

  it('charges the estimate when the chat cannot be read', async () => {
    const error = attachChatToError('timeout', 'chat-1', true)
    const usage = await recoverFailedCaseUsage(async () => {
      throw new Error('fetch failed')
    }, error, 0.25)

    expect(error).toBeInstanceOf(Error)
    expect(usage.costUsd).toBe(0.25)
    expect(usage.estimated).toBe(true)
  })

  it('charges the estimate when a send started but no cost is stored yet',
    async () => {
      const error = attachChatToError(new Error('timeout'), 'chat-1', true)
      const usage = await recoverFailedCaseUsage(async () => {
        return { messages: [{ role: 'user', usage: null }] }
      }, error)

      expect(usage.costUsd).toBe(DEFAULT_FAILED_CASE_ESTIMATE_USD)
      expect(usage.estimated).toBe(true)
    })

  it('charges nothing when the failure came before any send', async () => {
    const error = attachChatToError(new Error('chat fetch'), 'chat-1', false)
    const usage = await recoverFailedCaseUsage(async () => {
      return { messages: [] }
    }, error)

    expect(usage.costUsd).toBe(0)
    expect(usage.estimated).toBe(false)
  })
})

describe('stalled preview requests', () => {
  function timeoutError(): Error {
    const exception = new Error('The operation was aborted due to timeout')

    exception.name = 'TimeoutError'

    return exception
  }

  it('recognises abort and timeout errors only', () => {
    expect(isRequestTimeout(timeoutError())).toBe(true)
    expect(isRequestTimeout(Object.assign(new Error('x'), {
      name: 'AbortError',
    }))).toBe(true)
    expect(isRequestTimeout(new Error('GET /x: 500'))).toBe(false)
  })

  it('names the request that got no response', () => {
    expect(describeTimedOutRequest('GET', '/api/v1/chats/abc', 20000))
      .toBe('GET /api/v1/chats/abc got no response within 20000 ms')
  })

  it('retries a read that stalled once and returns the second answer',
    async () => {
      let calls = 0
      const result = await retryStalledRead(async () => {
        calls++

        if (calls === 1) {
          throw timeoutError()
        }

        return { ok: true }
      }, 2)

      expect(calls).toBe(2)
      expect(result).toEqual({ ok: true })
    })

  it('gives up with the timeout after the last attempt', async () => {
    let calls = 0

    await expect(retryStalledRead(async () => {
      calls++

      throw timeoutError()
    }, 2)).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(calls).toBe(2)
  })

  it('does not retry a read that failed with a status error', async () => {
    let calls = 0

    await expect(retryStalledRead(async () => {
      calls++

      throw new Error('GET /x: 404 not found')
    }, 2)).rejects.toThrow('404')
    expect(calls).toBe(1)
  })
})

describe('session client stalls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stalledFetchError(): Error {
    const exception = new Error('The operation was aborted due to timeout')

    exception.name = 'TimeoutError'

    return exception
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  it('retries a GET that stalled and returns the second answer', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(stalledFetchError())
      .mockResolvedValueOnce(jsonResponse({ slug: 'chat-1' }))

    vi.stubGlobal('fetch', fetchMock)

    const client = new SessionClient('https://preview.test')

    await expect(client.json('/api/v1/chats/chat-1'))
      .resolves.toEqual({ slug: 'chat-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('names the request and the attempts when every read stalls',
    async () => {
      const fetchMock = vi.fn().mockRejectedValue(stalledFetchError())

      vi.stubGlobal('fetch', fetchMock)

      const client = new SessionClient('https://preview.test')

      await expect(client.json('/api/v1/chats/chat-1')).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'GET /api/v1/chats/chat-1 got no response within 20000 ms '
          + 'after 2 attempts',
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

  it('never retries a write and names it', async () => {
    const fetchMock = vi.fn().mockRejectedValue(stalledFetchError())

    vi.stubGlobal('fetch', fetchMock)

    const client = new SessionClient('https://preview.test')

    await expect(client.json('/api/v1/chats/new', {
      method: 'PUT',
      body: { model: 'm' },
    })).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'PUT /api/v1/chats/new got no response within 60000 ms',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names a body read that stalled and retries it', async () => {
    const stalledBody = {
      ok: true,
      json: async () => {
        throw stalledFetchError()
      },
      headers: new Headers(),
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(stalledBody)
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }))

    vi.stubGlobal('fetch', fetchMock)

    const client = new SessionClient('https://preview.test')

    await expect(client.json('/api/v1/artifacts/a/versions/1'))
      .resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
