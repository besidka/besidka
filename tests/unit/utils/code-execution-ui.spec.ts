import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_EXECUTION_CODE_TRUNCATED_NOTICE,
  CODE_EXECUTION_STREAM_TRUNCATED_NOTICE,
  getCodeExecutionLanguageLabel,
  getCodeExecutionNote,
  getCodeExecutionSkippedFiles,
  getCodePreview,
  isCodeExecutionPart,
  isLastCodeExecutionPart,
  readCodeExecutionConfirmed,
  stripCodeExecutionTool,
  writeCodeExecutionConfirmed,
} from '../../../app/utils/code-execution-ui'

const DISCLAIMER = 'The provider runs the code; Besidka never executes it.'

describe('stripCodeExecutionTool', () => {
  it('removes only code_execution', () => {
    expect(
      stripCodeExecutionTool(['web_search', 'code_execution']),
    ).toEqual(['web_search'])
  })

  it('returns an equal list when the tool is absent', () => {
    expect(stripCodeExecutionTool(['web_search_exa'])).toEqual([
      'web_search_exa',
    ])
  })
})

describe('code execution part helpers', () => {
  const first = { type: 'tool-code_execution', toolCallId: 'a' }
  const second = { type: 'tool-code_execution', toolCallId: 'b' }
  const files = {
    type: 'data-code-execution-files',
    data: {
      savedCount: 1,
      skipped: [{ filename: 'big.csv', reason: 'too-large' }],
    },
  }
  const parts = [first, { type: 'text', text: 'hi' }, second, files]

  it('detects code execution parts', () => {
    expect(isCodeExecutionPart(first)).toBe(true)
    expect(isCodeExecutionPart({ type: 'text' })).toBe(false)
    expect(isCodeExecutionPart(null)).toBe(false)
  })

  it('marks only the last code execution part of a message', () => {
    expect(isLastCodeExecutionPart(parts, first)).toBe(false)
    expect(isLastCodeExecutionPart(parts, second)).toBe(true)
    expect(isLastCodeExecutionPart([], second)).toBe(false)
  })

  it('collects skipped files from the data part', () => {
    expect(getCodeExecutionSkippedFiles(parts)).toEqual([
      { filename: 'big.csv', reason: 'too-large' },
    ])
    expect(getCodeExecutionSkippedFiles([first])).toEqual([])
  })
})

describe('getCodePreview', () => {
  it('keeps short code whole', () => {
    expect(getCodePreview('a\nb')).toEqual({
      text: 'a\nb',
      hiddenLineCount: 0,
    })
  })

  it('cuts after four lines and counts the rest', () => {
    const code = ['1', '2', '3', '4', '5', '6'].join('\n')

    expect(getCodePreview(code)).toEqual({
      text: '1\n2\n3\n4',
      hiddenLineCount: 2,
    })
  })
})

describe('getCodeExecutionLanguageLabel', () => {
  it('names each language', () => {
    expect(getCodeExecutionLanguageLabel('python')).toBe('Python')
    expect(getCodeExecutionLanguageLabel('bash')).toBe('Bash')
    expect(getCodeExecutionLanguageLabel('text')).toBe('Text')
  })

  it('states the truncation limits in kilobytes', () => {
    expect(CODE_EXECUTION_CODE_TRUNCATED_NOTICE).toBe(
      'Code was truncated to 32 KB.',
    )
    expect(CODE_EXECUTION_STREAM_TRUNCATED_NOTICE).toBe(
      'Output was truncated to 32 KB.',
    )
  })
})

describe('getCodeExecutionNote', () => {
  it('writes the Anthropic note with the configured prices', () => {
    expect(getCodeExecutionNote('anthropic', {
      anthropicCodeExecutionCostPerHourUsd: '0.05',
      anthropicCodeExecutionFreeHoursPerMonth: '1550',
    })).toBe(
      'Runs in Anthropic\'s sandbox on your API key. Anthropic bills '
      + 'container time at $0.05 per hour after 1,550 free hours a month '
      + 'for your organisation, with a 5-minute minimum, and bills '
      + 'attached files even if no code runs. Free hours depend on your '
      + `organisation. ${DISCLAIMER}`,
    )
  })

  it('omits Anthropic numbers that are not configured', () => {
    const note = getCodeExecutionNote('anthropic', {
      anthropicCodeExecutionCostPerHourUsd: '',
      anthropicCodeExecutionFreeHoursPerMonth: '',
    })

    expect(note).toContain('container time (see your provider\'s pricing),')
    expect(note).not.toContain('$')
    expect(note).not.toContain('free hours a month')
  })

  it('writes the OpenAI note with and without the price', () => {
    expect(getCodeExecutionNote('openai', {
      openaiCodeInterpreterCostPerSessionUsd: '0.03',
    })).toBe(
      'Runs in OpenAI\'s sandbox on your API key. OpenAI bills about $0.03 '
      + 'per container session (1 GB, up to 20 minutes), separate from '
      + `tokens. ${DISCLAIMER}`,
    )
    expect(getCodeExecutionNote('openai', {})).toContain(
      'bills container sessions separately from tokens '
      + '(see your provider\'s pricing).',
    )
  })

  it('writes the Google note without any price', () => {
    const note = getCodeExecutionNote('google', {})

    expect(note).toContain('There is no extra charge beyond tokens.')
    expect(note).toContain('Switzerland and the UK')
    expect(note.endsWith(DISCLAIMER)).toBe(true)
  })

  it('falls back to a generic note for another provider', () => {
    expect(getCodeExecutionNote('xai', {})).toContain(
      'See your provider\'s pricing.',
    )
    expect(getCodeExecutionNote(null, {}).endsWith(DISCLAIMER)).toBe(true)
  })

  it('never uses payment or donation wording', () => {
    for (const provider of ['anthropic', 'openai', 'google']) {
      const note = getCodeExecutionNote(provider, {}).toLowerCase()

      expect(note).not.toMatch(/donat|tip|subscribe|buy|pay us/)
    }
  })
})

describe('code execution confirmation storage', () => {
  const storedValues = new Map<string, string>()

  beforeEach(() => {
    storedValues.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storedValues.set(key, value)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('remembers a confirmation per provider', () => {
    expect(readCodeExecutionConfirmed('openai')).toBe(false)

    writeCodeExecutionConfirmed('openai')

    expect(readCodeExecutionConfirmed('openai')).toBe(true)
    expect(readCodeExecutionConfirmed('anthropic')).toBe(false)
    expect(storedValues.get('besidka:code-execution-confirmed:openai'))
      .toBe('true')
  })

  it('renders fine without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })

    expect(readCodeExecutionConfirmed('openai')).toBe(false)
    expect(() => writeCodeExecutionConfirmed('openai')).not.toThrow()
  })

  it('treats a missing storage object as unconfirmed', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(readCodeExecutionConfirmed('openai')).toBe(false)
    expect(() => writeCodeExecutionConfirmed('openai')).not.toThrow()
  })
})
