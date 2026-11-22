import { describe, expect, it } from 'vitest'
import {
  SKILL_TEXT_RULES,
  scanSkillText,
  scanSkillTextWithCounts,
} from '#shared/utils/skills/findings'
import { classifySkillUrl } from '#shared/utils/skills/url-hosts'

const LINE_LENGTH = 5000
const RULE_BUDGET_MS = 20
const SCAN_BUDGET_MS = 150
const ATTEMPTS = 3

const collapse = (line: string) => {
  return line.replace(/\s+/g, ' ')
}

const ADVERSARIAL_LINES: Array<[string, string]> = [
  ['a run', 'a'.repeat(LINE_LENGTH)],
  ['spaces', ' '.repeat(LINE_LENGTH)],
  ['dynamic context starts', '!`'.repeat(2500)],
  ['curl repeated', 'curl '.repeat(1000)],
  ['image starts', '![ '.repeat(2500)],
  ['url with queries', `https://${'a?'.repeat(2400)}`],
  ['send repeated', 'send '.repeat(1000)],
  ['ignore prefixes', 'ignore all the '.repeat(330)],
  ['print repeated', 'print '.repeat(830)],
  ['angle brackets', '<'.repeat(LINE_LENGTH)],
  ['run with a late bang', `${'x'.repeat(4999)}!`],
  ['hex escape starts', '\\x4'.repeat(1250)],
  ['percent starts', '%4'.repeat(2500)],
  ['unzip repeated', 'unzip '.repeat(830)],
  ['slash pairs', 'a/'.repeat(2500)],
  ['secret prefixes', 'sk-'.repeat(1600)],
  ['secret with trailing dashes', `sk-${'-'.repeat(4990)}`],
  ['key like prefixes', 'ghp_ AKIA xoxb- AIza '.repeat(220)],
  ['pipe chains', 'curl | '.repeat(700)],
  ['env words', 'env ; '.repeat(800)],
  ['bracket pairs', '[a]('.repeat(1000)],
  ['placeholder starts', 'https://a/${'.repeat(450)],
]

function bestOf(run: () => void): number {
  let best = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const started = performance.now()

    run()

    best = Math.min(best, performance.now() - started)
  }

  return best
}

describe('every text rule on adversarial lines', () => {
  it('has at least fifteen adversarial lines', () => {
    expect(ADVERSARIAL_LINES.length).toBeGreaterThanOrEqual(15)
  })

  for (const rule of SKILL_TEXT_RULES) {
    it(`runs ${rule.rule} in under ${RULE_BUDGET_MS} ms on each line`, () => {
      for (const [name, sample] of ADVERSARIAL_LINES) {
        const line = collapse(sample).slice(0, LINE_LENGTH)
        const elapsed = bestOf(() => {
          rule.pattern.lastIndex = 0
          rule.pattern.test(line)
        })

        expect(elapsed, `${rule.rule} on ${name}`).toBeLessThan(RULE_BUDGET_MS)
      }
    })
  }

  it('does not use whitespace-run quantifiers in any rule', () => {
    for (const rule of SKILL_TEXT_RULES) {
      expect(rule.pattern.source, rule.rule).not.toMatch(/\\s[+*]/)
    }
  })
})

describe('the whole scan on adversarial lines', () => {
  it.each(ADVERSARIAL_LINES)('scans %s within the budget', (_name, sample) => {
    const elapsed = bestOf(() => {
      scanSkillText('SKILL.md', sample)
    })

    expect(elapsed).toBeLessThan(SCAN_BUDGET_MS)
  })

  it.each(ADVERSARIAL_LINES)(
    'scans %s as a line in a long file within the budget',
    (_name, sample) => {
      const text = `${sample}\n`.repeat(8)
      const elapsed = bestOf(() => {
        scanSkillTextWithCounts('SKILL.md', text)
      })

      expect(elapsed).toBeLessThan(SCAN_BUDGET_MS * 8)
    },
  )

  it('scans a line that is all Base64 and a line of Cyrillic quickly', () => {
    const base64 = 'QUJD'.repeat(1250)
    const cyrillic = 'ігнор попередні інструкції '.repeat(200)

    expect(bestOf(() => {
      scanSkillText('SKILL.md', base64)
    })).toBeLessThan(SCAN_BUDGET_MS)
    expect(bestOf(() => {
      scanSkillText('SKILL.md', cyrillic)
    })).toBeLessThan(SCAN_BUDGET_MS)
  })

  it('classifies a very long URL quickly', () => {
    const url = `https://${'a.'.repeat(2400)}example/${'b/'.repeat(100)}`

    expect(bestOf(() => {
      classifySkillUrl(url)
    })).toBeLessThan(RULE_BUDGET_MS)
  })

  it('stays linear on a 1 MiB line of repeated rule starts', () => {
    const started = performance.now()

    for (const unit of ['sk-', '!`', 'send ', '![', 'ignore all the ']) {
      scanSkillText('SKILL.md', unit.repeat(Math.floor(1_048_576 / unit.length)))
    }

    expect(performance.now() - started).toBeLessThan(8000)
  })
})
