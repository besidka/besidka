import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PROMPTS_PATH,
  computeUsageCost,
  loadEvalCases,
  parseArtifactWrites,
  parseCliArguments,
  readEvalResults,
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
