import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FAILED_CASE_ESTIMATE_USD,
  DEFAULT_PROMPTS_PATH,
  attachChatToError,
  computeUsageCost,
  isValidUsdAmount,
  recoverFailedCaseUsage,
  findEchoedSourceLines,
  findStreamError,
  loadEvalCases,
  parseFencedBlocks,
  parseArtifactWrites,
  parseCliArguments,
  readEvalResults,
  readReplyText,
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

    expect(cases.length).toBeGreaterThanOrEqual(20)
    expect(cases.length).toBeLessThanOrEqual(30)
    expect(cases.some(evalCase => evalCase.checks.includes('no-artifact')))
      .toBe(true)
    expect(cases.some(evalCase => evalCase.checks.includes('no-navigation')))
      .toBe(true)
    expect(cases.some(evalCase => evalCase.followUp)).toBe(true)
  })

  it('keeps diagrams and code inline unless an artifact is asked for', () => {
    const cases = loadEvalCases(DEFAULT_PROMPTS_PATH)
    const byId = new Map(cases.map(evalCase => [evalCase.id, evalCase]))
    const inlineCases = cases.filter((evalCase) => {
      return evalCase.checks.includes('no-artifact')
        && evalCase.checks.some((check) => {
          return check === 'inline-mermaid' || check === 'inline-code'
        })
    })

    expect(byId.get('mermaid-flowchart')?.checks)
      .toEqual(['no-artifact', 'inline-mermaid', 'no-source-echo'])
    expect(byId.get('owner-mermaid-uk')).toMatchObject({
      prompt: 'згенеруй мені mermaid діаграму',
      followUp: 'будь-яку, два трикутники',
    })
    expect(inlineCases.length).toBeGreaterThanOrEqual(8)
    expect(inlineCases.some(evalCase => /[Ѐ-ӿ]/.test(evalCase.prompt)))
      .toBe(true)
    expect(byId.get('explicit-artifact-mermaid')?.checks)
      .toContain('artifact')
    expect(byId.get('explicit-artifact-uk')?.checks).toContain('artifact')
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

describe('reply text checks', () => {
  const inlineCase = {
    ...QUIZ_CASE,
    expectedKind: [],
    checks: ['no-artifact', 'inline-mermaid', 'inline-code', 'no-source-echo'],
  }

  it('passes a fenced diagram and code without an artifact', () => {
    const replyText = 'Here it is:\n```mermaid\nflowchart TD\n  A --> B\n```'

    expect(scoreStaticChecks(inlineCase, {
      writes: [],
      artifacts: [],
      replyText,
    })).toEqual({
      'no-artifact': { status: 'pass' },
      'inline-mermaid': { status: 'pass' },
      'inline-code': { status: 'pass', note: '1 fenced block(s)' },
      'no-source-echo': { status: 'pass' },
    })
  })

  it('fails diagram, page or script source outside a fence', () => {
    for (const replyText of [
      'flowchart LR\n  A --> B',
      'Start[Open] --> End',
      'sequenceDiagram\n  A->>B: hi',
      '<!DOCTYPE html><html></html>',
      '#!/bin/bash\necho hi',
      'import { useState } from \'react\'',
    ]) {
      const checks = scoreStaticChecks(inlineCase, {
        writes: [],
        artifacts: [],
        replyText,
      })

      expect(checks['no-source-echo'], replyText).toEqual({
        status: 'fail',
        note: 'source outside a fenced block',
      })
    }

    expect(scoreStaticChecks(inlineCase, {
      writes: [],
      artifacts: [],
      replyText: 'A plain answer that mentions a graph and an import.',
    })['inline-mermaid'].status).toBe('fail')
  })

  it('fails a reply that repeats the artifact it wrote', () => {
    const content = [
      'flowchart TD',
      '  open[Pull request opened] --> review[Review]',
      '  review --> changes[Changes requested]',
      '  review --> approve[Approved by reviewer]',
      '  approve --> merge[Merged into main]',
    ].join('\n')
    const artifacts = [{ kind: 'mermaid', content }]
    const echoCase = { ...QUIZ_CASE, checks: ['no-source-echo'] }

    expect(findEchoedSourceLines(artifacts, `\`\`\`\n${content}\n\`\`\``))
      .toHaveLength(4)
    expect(scoreStaticChecks(echoCase, {
      writes: [],
      artifacts,
      replyText: `\`\`\`mermaid\n${content}\n\`\`\``,
    })['no-source-echo']).toEqual({
      status: 'fail',
      note: '4 artifact lines repeated in the reply',
    })
    expect(scoreStaticChecks(echoCase, {
      writes: [],
      artifacts,
      replyText: 'I made the review flow as a diagram artifact.',
    })['no-source-echo'].status).toBe('pass')
  })

  it('leaves the text checks pending without stored reply text', () => {
    expect(scoreStaticChecks(inlineCase, { writes: [], artifacts: [] }))
      .toMatchObject({
        'inline-mermaid': { status: 'pending' },
        'no-source-echo': { status: 'pending' },
      })
  })

  it('reads fences the way Markdown does', () => {
    const nested = '````md\n```mermaid\nflowchart TD\n```\n````\nDone.'

    expect(parseFencedBlocks(nested)).toEqual({
      blocks: [{ info: 'md', closed: true }],
      outside: 'Done.',
    })
    expect(parseFencedBlocks('~~~bash\necho hi\n~~~').blocks)
      .toEqual([{ info: 'bash', closed: true }])
    expect(parseFencedBlocks('```ts\nconst a = 1').blocks)
      .toEqual([{ info: 'ts', closed: false }])
    expect(scoreStaticChecks(inlineCase, {
      writes: [],
      artifacts: [],
      replyText: 'Use a ```mermaid fence:\r\n```mermaid\r\ngraph LR\r\n'
        + '  A --> B\r\n```',
    })).toMatchObject({
      'inline-mermaid': { status: 'pass' },
      'no-source-echo': { status: 'pass' },
    })
  })

  it('catches Cyrillic node ids and ignores prose about diagrams', () => {
    const echoOf = (replyText: string) => {
      return scoreStaticChecks(inlineCase, {
        writes: [],
        artifacts: [],
        replyText,
      })['no-source-echo'].status
    }

    expect(echoOf('Початок --> Кінець')).toBe('fail')
    expect(echoOf('Кошик[Кошик] -->|оплата| Оплата')).toBe('fail')
    expect(echoOf('Wrap the page in an `<html>` element.')).toBe('pass')
    expect(echoOf('The arrow --> means "leads to".')).toBe('pass')
  })

  it('reads only the visible assistant text of every turn', () => {
    expect(readReplyText([
      { role: 'user', parts: [{ type: 'text', text: 'question' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'first' },
          { type: 'tool-create_artifact', input: {} },
        ],
      },
      { role: 'assistant', parts: [{ type: 'text', text: 'second' }] },
    ])).toBe('first\n\nsecond')
    expect(readReplyText(undefined)).toBe('')
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
