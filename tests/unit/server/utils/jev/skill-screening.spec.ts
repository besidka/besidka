import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JEV_SKILL_QUESTION_IDS,
  JEV_SKILL_SCREENING,
} from '#shared/utils/jev-policy'
import type { SkillFinding } from '#shared/utils/skills/findings'
import {
  createSkillJevMark,
  mergeSkillJevFindings,
  toSkillJevFindings,
} from '#shared/utils/skills/jev-findings'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import { splitTextWithLineRanges } from '~~/server/utils/jev/injection-screening'
import {
  locateDescriptionLines,
  orderFilesForScreening,
  screenSkillText,
  skillScreeningCacheKey,
} from '~~/server/utils/jev/skill-screening'
import type {
  SkillScreeningFile,
} from '~~/server/utils/jev/skill-screening'
import { createFakeSkillKv } from '../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

const {
  maxCallsPerScreen,
  maxCallsPerStage,
  maxConcurrentCalls,
  flagAtOrAbove,
} = JEV_SKILL_SCREENING
const USER_ID = 7
const DESCRIPTION = 'Review a pull request carefully'
const CARD_NUMBER = '4111 1111 1111 1111'

interface DecideCall {
  state: { text: string, description: string }
  questions: Record<string, { instructions: string, criteria?: unknown }>
}

function testModel() {
  const model = createJevDecisionModel('ts-test-key')

  if (!model) {
    throw new Error('expected a model')
  }

  return model
}

function answers(overrides: Record<string, number> = {}) {
  return {
    answers: Object.fromEntries(JEV_SKILL_QUESTION_IDS.map((id) => {
      return [id, { type: 'boolean', probability: overrides[id] ?? 0.02 }]
    })),
    usage: { inputTokens: 10 },
  }
}

function decideCalls(): DecideCall[] {
  return mocks.decide.mock.calls.map(call => call[0] as DecideCall)
}

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function paragraphs(prefix: string, count: number): string {
  return Array.from({ length: count }, (_value, index) => {
    return `${prefix} ${index} ${'word '.repeat(150)}`
  }).join('\n')
}

function chunkCountOf(text: string): number {
  return splitTextWithLineRanges(text, JEV_SKILL_SCREENING.maxChunkTokens)
    .length
}

function skillMd(body = 'Read the diff and list the risks.\n'): string {
  return [
    '---',
    'name: review-pr',
    `description: ${DESCRIPTION}`,
    '---',
    body,
  ].join('\n')
}

function file(
  path: string,
  text: string,
  kind: SkillScreeningFile['kind'] = 'reference',
): SkillScreeningFile {
  return { path, kind, text }
}

async function screen(input: {
  files: SkillScreeningFile[]
  description?: string
  maxCalls?: number
  kv?: ReturnType<typeof createFakeSkillKv>
  logger?: { set: ReturnType<typeof vi.fn> }
}) {
  const kv = input.kv ?? createFakeSkillKv()

  return {
    kv,
    outcome: await screenSkillText({
      model: testModel(),
      userId: USER_ID,
      kv,
      description: input.description ?? DESCRIPTION,
      files: input.files,
      maxCalls: input.maxCalls ?? maxCallsPerScreen,
      logger: input.logger,
    }),
  }
}

describe('screenSkillText', () => {
  beforeEach(() => {
    mocks.decide.mockReset()
    mocks.decide.mockImplementation(async () => answers())
  })

  describe('state only', () => {
    it('keeps skill text, description and paths out of every question', async () => {
      const textMarker = 'TEXTMARKER4471'
      const descriptionMarker = 'DESCMARKER9082'
      const pathMarker = 'PATHMARKER3315'

      await screen({
        description: `${DESCRIPTION} ${descriptionMarker}`,
        files: [
          file('SKILL.md', skillMd(`Body ${textMarker}\n`), 'skill-md'),
          file(`references/${pathMarker}.md`, `Notes ${textMarker}\n`),
        ],
      })

      const calls = decideCalls()

      expect(calls.length).toBeGreaterThan(0)

      for (const call of calls) {
        const questionText = JSON.stringify(call.questions)

        expect(questionText).not.toContain(textMarker)
        expect(questionText).not.toContain(descriptionMarker)
        expect(questionText).not.toContain(pathMarker)
        expect(JSON.stringify(call.state)).not.toContain(pathMarker)
        expect(Object.keys(call.state).sort()).toEqual([
          'description',
          'text',
        ])
      }

      const texts = calls.map(call => call.state.text).join('\n')

      expect(texts).toContain(textMarker)
      expect(calls[0]!.state.description).toContain(descriptionMarker)
    })

    it('sends the constant wordings of the policy', async () => {
      await screen({ files: [file('SKILL.md', skillMd(), 'skill-md')] })

      for (const call of decideCalls()) {
        expect(Object.keys(call.questions)).toEqual([
          ...JEV_SKILL_QUESTION_IDS,
        ])

        for (const id of JEV_SKILL_QUESTION_IDS) {
          expect(call.questions[id]).toEqual(
            JEV_SKILL_SCREENING.questions[id],
          )
        }
      }
    })
  })

  it('makes one call per chunk with all six questions', async () => {
    const body = paragraphs('Section', 30)
    const files = [
      file('SKILL.md', skillMd(), 'skill-md'),
      file('references/guide.md', body),
    ]
    const { outcome } = await screen({ files })
    const expectedChunks = 1 + chunkCountOf(files[0]!.text)
      + chunkCountOf(body)

    expect(chunkCountOf(body)).toBeGreaterThan(1)
    expect(outcome.totalChunks).toBe(expectedChunks)
    expect(outcome.calls).toBe(expectedChunks)
    expect(mocks.decide).toHaveBeenCalledTimes(expectedChunks)

    for (const call of decideCalls()) {
      expect(Object.keys(call.questions)).toHaveLength(6)
    }
  })

  it('never has more than maxConcurrentCalls calls in flight', async () => {
    let inFlight = 0
    let peak = 0

    mocks.decide.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--

      return answers()
    })

    await screen({
      files: [file('references/big.md', paragraphs('Part', 40))],
    })

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(maxConcurrentCalls)
  })

  describe('priority order and budget', () => {
    it('sends description, SKILL.md, documents, other text, scripts, license', async () => {
      const files = [
        file('LICENSE', 'LICENSETEXT', 'license'),
        file('scripts/run.sh', 'SCRIPTTEXT', 'script'),
        file('data/table.json', 'OTHERTEXT', 'other'),
        file('notes.txt', 'NOTESTEXT', 'other'),
        file('references/b.md', 'REFERENCEB'),
        file('references/a.md', 'REFERENCEA'),
        file('SKILL.md', skillMd('SKILLBODY\n'), 'skill-md'),
      ]

      await screen({ files })

      const texts = decideCalls().map(call => call.state.text)
      const order = [
        DESCRIPTION,
        'SKILLBODY',
        'NOTESTEXT',
        'REFERENCEA',
        'REFERENCEB',
        'OTHERTEXT',
        'SCRIPTTEXT',
        'LICENSETEXT',
      ]

      expect(texts).toHaveLength(order.length)
      order.forEach((marker, index) => {
        expect(texts[index]).toContain(marker)
      })
      expect(orderFilesForScreening(files).map(item => item.path)).toEqual([
        'SKILL.md',
        'notes.txt',
        'references/a.md',
        'references/b.md',
        'data/table.json',
        'scripts/run.sh',
        'LICENSE',
      ])
    })

    it('stops at the call budget and returns the rest as unchecked ranges', async () => {
      const big = paragraphs('Line', 120)
      const chunks = splitTextWithLineRanges(
        big,
        JEV_SKILL_SCREENING.maxChunkTokens,
      )
      const { outcome } = await screen({
        files: [
          file('SKILL.md', skillMd(), 'skill-md'),
          file('references/big.md', big),
        ],
        maxCalls: maxCallsPerScreen,
      })
      const checkedOfBig = maxCallsPerScreen - 2

      expect(chunks.length).toBeGreaterThan(maxCallsPerScreen)
      expect(outcome.calls).toBe(maxCallsPerScreen)
      expect(outcome.status).toBe('ok')
      expect(outcome.unchecked).toEqual([{
        path: 'references/big.md',
        startLine: chunks[checkedOfBig]!.startLine,
        endLine: chunks[chunks.length - 1]!.endLine,
      }])
      expect(outcome.tooLarge).toBe(false)
    })

    it('reports a skill beyond maxCallsPerStage as too large', async () => {
      const huge = paragraphs('Row', 700)
      const chunks = splitTextWithLineRanges(
        huge,
        JEV_SKILL_SCREENING.maxChunkTokens,
      )
      const { outcome } = await screen({
        files: [file('references/huge.md', huge)],
        maxCalls: 1000,
      })
      const checkedOfHuge = maxCallsPerStage - 1

      expect(chunks.length).toBeGreaterThan(maxCallsPerStage)
      expect(outcome.tooLarge).toBe(true)
      expect(outcome.calls).toBe(maxCallsPerStage)
      expect(outcome.unchecked).toEqual([{
        path: 'references/huge.md',
        startLine: chunks[checkedOfHuge]!.startLine,
        endLine: chunks[chunks.length - 1]!.endLine,
      }])
    })

    it('keeps line ranges right when blank chunks are dropped', () => {
      const text = `first\n${'\n'.repeat(5000)}last\n`
      const chunks = splitTextWithLineRanges(text, 50)

      expect(chunks[0]!.startLine).toBe(1)
      expect(chunks[chunks.length - 1]!.endLine).toBe(5002)
      expect(chunks.every(chunk => chunk.text.trim().length > 0)).toBe(true)
    })

    it('points a description mark at the description lines of SKILL.md', async () => {
      expect(locateDescriptionLines(skillMd())).toEqual({
        startLine: 3,
        endLine: 3,
      })
      expect(locateDescriptionLines([
        '---',
        'name: x',
        'description: >',
        '  one',
        '  two',
        'license: MIT',
        '---',
      ].join('\n'))).toEqual({ startLine: 3, endLine: 5 })
      expect(locateDescriptionLines('no frontmatter')).toEqual({
        startLine: 1,
        endLine: 1,
      })

      mocks.decide.mockImplementation(async (call: DecideCall) => {
        return call.state.text === DESCRIPTION
          ? answers({ k2_conceal: 0.9 })
          : answers()
      })

      const { outcome } = await screen({
        files: [file('SKILL.md', skillMd(), 'skill-md')],
      })

      expect(outcome.marks).toEqual([createSkillJevMark({
        path: 'SKILL.md',
        startLine: 3,
        endLine: 3,
        question: 'k2_conceal',
        score: 0.9,
      })])
    })
  })

  describe('marks', () => {
    it('marks a chunk at its threshold with the severity of the question', async () => {
      mocks.decide.mockImplementation(async () => answers({
        i2_attack: flagAtOrAbove.i2_attack,
        k1_send_out: flagAtOrAbove.k1_send_out,
        k2_conceal: flagAtOrAbove.k2_conceal,
        k3_secrets: flagAtOrAbove.k3_secrets,
        k4_run_remote: flagAtOrAbove.k4_run_remote,
        k5_off_purpose: flagAtOrAbove.k5_off_purpose,
      }))

      const { outcome } = await screen({
        description: '',
        files: [file('references/a.md', 'one line\n')],
      })
      const severities = Object.fromEntries(outcome.marks.map((mark) => {
        return [mark.question, mark.severity]
      }))

      expect(severities).toEqual({
        i2_attack: 'medium',
        k1_send_out: 'high',
        k2_conceal: 'high',
        k3_secrets: 'high',
        k4_run_remote: 'medium',
        k5_off_purpose: 'low',
      })
    })

    it('does not mark a chunk just below the threshold', async () => {
      mocks.decide.mockImplementation(async () => answers({
        i2_attack: flagAtOrAbove.i2_attack - 0.01,
        k5_off_purpose: flagAtOrAbove.k5_off_purpose - 0.01,
      }))

      const { outcome } = await screen({
        description: '',
        files: [file('references/a.md', 'one line\n')],
      })

      expect(outcome.marks).toEqual([])
      expect(outcome.unchecked).toEqual([])
    })
  })

  describe('failures leave the review as it is', () => {
    const failures: Array<[string, () => unknown, string]> = [
      ['401', () => apiError(401), 'unauthorized'],
      ['403', () => apiError(403), 'unauthorized'],
      ['429', () => apiError(429), 'rate-limited'],
      ['529', () => apiError(529), 'rate-limited'],
      [
        'a timeout',
        () => new DOMException('timed out', 'TimeoutError'),
        'timeout',
      ],
      ['a network failure', () => new TypeError('fetch failed'), 'network'],
      ['a refusal', () => new Error('The model refused to answer'), 'error'],
      ['a server error', () => apiError(500), 'error'],
    ]

    it.each(failures)(
      'fails open on %s',
      async (_label, createFailure, status) => {
        mocks.decide.mockImplementation(async () => {
          throw createFailure()
        })

        const files = [
          file('SKILL.md', skillMd(), 'skill-md'),
          file('references/a.md', 'REFERENCE\n'),
        ]
        const { outcome, kv } = await screen({ files })

        expect(outcome.status).toBe(status)
        expect(outcome.marks).toEqual([])
        expect(outcome.unchecked.map(range => range.path)).toEqual([
          'SKILL.md',
          'references/a.md',
        ])
        expect(kv.put).not.toHaveBeenCalled()
      },
    )

    it('fails open on a missing probability', async () => {
      mocks.decide.mockImplementation(async () => {
        const result = answers()

        delete (result.answers as Record<string, unknown>).k4_run_remote

        return result
      })

      const { outcome, kv } = await screen({
        files: [file('references/a.md', 'REFERENCE\n')],
      })

      expect(outcome.status).toBe('error')
      expect(outcome.marks).toEqual([])
      expect(outcome.unchecked.map(range => range.path)).toEqual([
        'SKILL.md',
        'references/a.md',
      ])
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('keeps the marks of chunks that were checked before a failure', async () => {
      let call = 0

      mocks.decide.mockImplementation(async () => {
        call++

        if (call === 1) {
          return answers({ k1_send_out: 0.95 })
        }

        throw apiError(429)
      })

      const { outcome } = await screen({
        files: [
          file('references/a.md', 'FIRST\n'),
          file('references/b.md', 'SECOND\n'),
          file('references/c.md', 'THIRD\n'),
          file('references/d.md', 'FOURTH\n'),
        ],
        description: '',
        maxCalls: 3,
      })

      expect(outcome.status).toBe('rate-limited')
      expect(outcome.marks.map(mark => mark.question)).toEqual(['k1_send_out'])
      expect(outcome.unchecked.map(range => range.path)).toEqual([
        'references/b.md',
        'references/c.md',
        'references/d.md',
      ])
    })

    it('does not call at all when the budget is zero', async () => {
      const { outcome } = await screen({
        files: [file('references/a.md', 'REFERENCE\n')],
        maxCalls: 0,
      })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(outcome.calls).toBe(0)
      expect(outcome.unchecked).toHaveLength(2)
    })
  })

  describe('chunk cache', () => {
    it('makes no call when the same text is screened again', async () => {
      const files = [
        file('SKILL.md', skillMd(), 'skill-md'),
        file('references/a.md', paragraphs('Cached', 12)),
      ]
      const first = await screen({ files })

      expect(first.outcome.calls).toBeGreaterThan(1)

      mocks.decide.mockClear()

      const second = await screen({ files, kv: first.kv })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(second.outcome.calls).toBe(0)
      expect(second.outcome.cachedChunks).toBe(first.outcome.totalChunks)
      expect(second.outcome.marks).toEqual(first.outcome.marks)
    })

    it('pays only for the chunks that changed in an update', async () => {
      const original = paragraphs('Stable', 40)
      const files = [file('references/a.md', original)]
      const first = await screen({ files })
      const chunks = splitTextWithLineRanges(
        original,
        JEV_SKILL_SCREENING.maxChunkTokens,
      )

      expect(chunks.length).toBeGreaterThan(2)

      mocks.decide.mockClear()

      const updated = original.replace('Stable 0 ', 'Changed 0 ')
      const second = await screen({
        files: [file('references/a.md', updated)],
        kv: first.kv,
      })

      expect(second.outcome.calls).toBe(1)
      expect(second.outcome.cachedChunks).toBe(chunks.length)
      expect(decideCalls()[0]!.state.text).toContain('Changed 0')
    })

    it('screens again when the description changes (k5 reads it)', async () => {
      const files = [file('references/a.md', 'SAME TEXT\n')]
      const first = await screen({ files })

      mocks.decide.mockClear()

      const second = await screen({
        files,
        kv: first.kv,
        description: 'A completely different purpose',
      })

      expect(second.outcome.calls).toBe(second.outcome.totalChunks)
    })

    it('keys the cache by user, question set and both hashes, never text', async () => {
      const { kv } = await screen({
        files: [file('references/a.md', 'SECRETLINE visible text\n')],
      })
      const keys = [...kv.values.keys()]

      expect(keys.length).toBeGreaterThan(0)

      for (const key of keys) {
        expect(key).toMatch(
          new RegExp(`^skills:jev:u${USER_ID}:${
            JEV_SKILL_SCREENING.questionSetVersion
          }:[0-9a-f]{64}:[0-9a-f]{64}$`),
        )
        expect(key).not.toContain('SECRETLINE')
      }

      for (const value of kv.values.values()) {
        expect(value).not.toContain('SECRETLINE')
        expect(Object.keys(JSON.parse(value))).toEqual(['scores'])
      }

      expect(skillScreeningCacheKey({
        userId: 1,
        chunkSha256: 'a'.repeat(64),
        descriptionSha256: 'b'.repeat(64),
      })).toBe(`skills:jev:u1:${
        JEV_SKILL_SCREENING.questionSetVersion
      }:${'a'.repeat(64)}:${'b'.repeat(64)}`)
    })

    it('does not cache a failed or incomplete answer', async () => {
      mocks.decide.mockImplementation(async () => {
        throw apiError(429)
      })

      const { kv } = await screen({
        files: [file('references/a.md', 'REFERENCE\n')],
      })

      expect(kv.values.size).toBe(0)
    })

    it('screens normally when the cache cannot be read or written', async () => {
      const kv = createFakeSkillKv()

      kv.get.mockRejectedValue(new Error('kv down'))
      kv.put.mockRejectedValue(new Error('kv down'))

      const { outcome } = await screen({
        files: [file('references/a.md', 'REFERENCE\n')],
        kv,
      })

      expect(outcome.status).toBe('ok')
      expect(outcome.calls).toBe(outcome.totalChunks)
    })

    it('screens a repeated chunk once', async () => {
      const { outcome } = await screen({
        description: '',
        files: [
          file('references/a.md', 'IDENTICAL TEXT\n'),
          file('references/b.md', 'IDENTICAL TEXT\n'),
        ],
      })

      expect(outcome.totalChunks).toBe(2)
      expect(outcome.calls).toBe(1)
      expect(outcome.unchecked).toEqual([])
    })
  })

  describe('redaction before jevDecide', () => {
    it('never sends a never-store value in the text or the description', async () => {
      await screen({
        description: `Pays with ${CARD_NUMBER}`,
        files: [
          file(
            'SKILL.md',
            skillMd(`Charge card ${CARD_NUMBER} now\n`),
            'skill-md',
          ),
          file('references/a.md', `Also ${CARD_NUMBER}\n`),
        ],
      })

      const calls = decideCalls()

      expect(calls.length).toBeGreaterThan(0)

      for (const call of calls) {
        expect(call.state.text).not.toContain(CARD_NUMBER)
        expect(call.state.description).not.toContain(CARD_NUMBER)
        expect(call.state.text).not.toContain('4111')
      }
    })

    it('hashes the redacted text, so the cache holds no trace of the value', async () => {
      const { kv } = await screen({
        files: [file('references/a.md', `Card ${CARD_NUMBER}\n`)],
      })
      const other = await screen({
        files: [file('references/a.md', 'Card 4242 4242 4242 4242\n')],
        kv,
      })

      expect(other.outcome.calls).toBe(0)
    })
  })

  it('logs counts only, under injectionScreeningJev with source skill', async () => {
    const logger = { set: vi.fn() }
    let context: Record<string, unknown> = {}

    logger.set.mockImplementation((fields: Record<string, unknown>) => {
      context = { ...context, ...fields }
    })

    await screenSkillText({
      model: testModel(),
      userId: USER_ID,
      kv: createFakeSkillKv(),
      description: DESCRIPTION,
      files: [file('references/a.md', 'PRIVATEBODY\n')],
      maxCalls: maxCallsPerScreen,
      logger: Object.assign(logger, { getContext: () => context }),
    })

    const attributes = context.attributes as Record<
      string,
      Record<string, unknown>
    >
    const record = attributes.injectionScreeningJev!

    expect(record.source).toBe('skill')
    expect(record.calls).toBe(2)
    expect(record.counts).toMatchObject({
      skillChunks: 2,
      skillMarked: 0,
      skillUnchecked: 0,
    })
    expect(JSON.stringify(context)).not.toContain('PRIVATEBODY')
    expect(JSON.stringify(context)).not.toContain(DESCRIPTION)
  })
})

describe('a Jev result is add-only', () => {
  function createGenerator(seed: number) {
    let state = seed

    return () => {
      state = (state + 0x6D2B79F5) | 0

      let value = Math.imul(state ^ (state >>> 15), 1 | state)

      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value

      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }

  function randomRuleFindings(random: () => number): SkillFinding[] {
    const severities = ['high', 'medium', 'low'] as const

    const count = Math.floor(random() * 12)

    return Array.from({ length: count }, (_value, index) => {
      return {
        type: 'execution',
        rule: `rule-${Math.floor(random() * 5)}`,
        severity: severities[Math.floor(random() * 3)]!,
        path: `file-${Math.floor(random() * 3)}.md`,
        line: Math.floor(random() * 20) + 1,
        snippet: `snippet ${index}`,
        detail: null,
        source: 'rules',
      } satisfies SkillFinding
    })
  }

  function randomMarks(random: () => number) {
    return Array.from({ length: Math.floor(random() * 12) }, () => {
      const startLine = Math.floor(random() * 20) + 1

      return createSkillJevMark({
        path: `file-${Math.floor(random() * 3)}.md`,
        startLine,
        endLine: startLine + Math.floor(random() * 5),
        question: JEV_SKILL_QUESTION_IDS[Math.floor(random() * 6)]!,
        score: random(),
      })
    })
  }

  it('never lowers, removes, reorders or rewrites a rule finding', () => {
    const random = createGenerator(20261114)

    for (let round = 0; round < 300; round++) {
      const ruleFindings = randomRuleFindings(random)
      const snapshot = structuredClone(ruleFindings)
      const merged = mergeSkillJevFindings(
        ruleFindings,
        toSkillJevFindings(randomMarks(random)),
      )

      expect(merged.slice(0, ruleFindings.length)).toEqual(snapshot)
      merged.slice(0, ruleFindings.length).forEach((finding, index) => {
        expect(finding).toBe(ruleFindings[index])
      })
      expect(ruleFindings).toEqual(snapshot)
      expect(merged.length).toBeGreaterThanOrEqual(ruleFindings.length)

      for (const added of merged.slice(ruleFindings.length)) {
        expect(added.source).toBe('jev')
      }
    }
  })

  it('adds nothing for an empty result and ignores rule-sourced input', () => {
    const ruleFindings = randomRuleFindings(createGenerator(1))

    expect(mergeSkillJevFindings(ruleFindings, [])).toEqual(ruleFindings)
    expect(mergeSkillJevFindings(ruleFindings, ruleFindings)).toEqual(
      ruleFindings,
    )
  })

  it('turns a mark into a Jev finding without text', () => {
    const [finding] = toSkillJevFindings([createSkillJevMark({
      path: 'SKILL.md',
      startLine: 4,
      endLine: 9,
      question: 'k3_secrets',
      score: 0.8123,
    })])

    expect(finding).toMatchObject({
      type: 'credential',
      rule: 'jev-secrets',
      severity: 'high',
      path: 'SKILL.md',
      line: 4,
      snippet: '',
      source: 'jev',
    })
  })
})
