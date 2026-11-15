import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Review from '../../../../../app/components/Profile/Skills/Review.vue'
import { EXTRA_FINDING_EXPLANATIONS } from '#shared/utils/skills/finding-explanations'
import {
  SKILL_FINDING_CATALOG_CALLOUT,
  SKILL_TEXT_RULES,
  getSkillFindingExplanation,
} from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { createImportPreview } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

enableAutoUnmount(afterEach)

const BANNED_WORDS
  = /\b(?:safe|safety rating|clean|verified|trusted|harmless|malicious)\b/i

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function stripMandatedSentences(text: string): string {
  return text
    .replace('cannot tell whether a skill is safe', '')
    .replace(
      'No highlight does not mean the text is harmless.',
      '',
    )
}

function makeFinding(overrides: Partial<SkillFinding>): SkillFinding {
  return {
    type: 'url',
    rule: 'url',
    severity: 'low',
    path: 'SKILL.md',
    line: 4,
    snippet: 'x',
    detail: null,
    source: 'rules',
    ...overrides,
  }
}

describe('Profile/Skills/Review', () => {
  it('shows the license once, as one row with a badge for the class', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), fileName: 'review-pr.zip' },
    })

    expect(wrapper.get(testId('skill-review-license')).text())
      .toBe('MIT · open license')
    expect(wrapper.get(testId('skill-review-license-class')).classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-soft']))
    expect(wrapper.find(testId('skill-review-license-field')).exists())
      .toBe(false)
    expect(wrapper.find(testId('skill-review-license-root')).exists())
      .toBe(false)
    expect(wrapper.findAll('dt').filter((term) => {
      return /licen[cs]e/i.test(term.text())
    }).map((term) => {
      return term.text()
    })).toEqual(['License'])
    expect(wrapper.get(testId('skill-review-license-text')).text())
      .toContain('License text')
    expect(wrapper.get(testId('skill-review-license-text')).text())
      .toContain('MIT License')
    expect(wrapper.get(testId('skill-review-source')).text())
      .toBe('Uploaded file review-pr.zip')
  })

  it('shows the raw license field only when it differs from the detected license', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: 'Apache 2 with extras' },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-field')).text())
      .toBe('Apache 2 with extras')

    const sameWithOtherCase = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: 'mit' },
        }),
      },
    })

    expect(sameWithOtherCase.find(testId('skill-review-license-field')).exists())
      .toBe(false)
  })

  it('says "From the repository root" once when the root license was used', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          license: { ...base.license, fromRepositoryRoot: true },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-root')).text())
      .toBe('From the repository root')
  })

  it('shows a license class without an SPDX id as one badge', async () => {
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          skill: { ...base.skill, license: null },
          license: {
            ...base.license,
            class: 'none',
            spdx: null,
            file: null,
            licenseText: null,
            licenseField: null,
          },
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license')).text())
      .toBe('No license stated')
    expect(wrapper.find(testId('skill-review-license-text')).exists())
      .toBe(false)
  })

  it('scrolls to the line of a finding that is clicked', async () => {
    const scrollIntoView = vi.fn()

    Element.prototype.scrollIntoView = scrollIntoView

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    await wrapper.findAll(testId('skill-review-finding'))[0]!.trigger('click')
    await flushPromises()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('shows compatibility and the requested tools as not granted', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    expect(wrapper.get(testId('skill-review-compatibility')).text())
      .toBe('Any chat model')
    expect(wrapper.get(testId('skill-review-allowed-tools')).text())
      .toContain('requested by the author, not granted')
  })

  it('warns that installing is like installing software and never calls a skill safe', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })
    const text = wrapper.get(testId('skill-review-warning')).text()

    expect(text).toContain(
      'Installing a skill is like installing software. Only continue if you trust its author.',
    )
    expect(text).toContain(
      'Besidka highlights links and commands so you can review them. It cannot tell whether a skill is safe.',
    )
    expect(text).toContain('1 link')
    expect(text).toContain('1 command')
    expect(wrapper.text().replace('cannot tell whether a skill is safe', ''))
      .not.toMatch(/\bis safe\b|\bsafe to\b|\bverified\b/i)
  })

  it('groups the highlights by severity in three named groups', async () => {
    const base = createImportPreview()
    const finding = {
      path: 'SKILL.md',
      line: 4,
      snippet: 'x',
      detail: null,
      source: 'rules' as const,
    }
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [
            {
              ...finding,
              type: 'url',
              rule: 'url',
              severity: 'low',
              line: 1,
            },
            {
              ...finding,
              type: 'injection',
              rule: 'injection-override',
              severity: 'high',
              line: 2,
            },
            {
              ...finding,
              type: 'secret',
              rule: 'secret-ssh-path',
              severity: 'medium',
              line: 3,
            },
          ],
          files: base.files,
        }),
      },
    })
    const summaries = wrapper.findAll('summary').map((summary) => {
      return summary.text()
    }).filter((text) => {
      return /\(\d+\)$/.test(text)
    })

    expect(summaries).toEqual([
      'Look closely (1)',
      'Worth a look (1)',
      'For your information (1)',
    ])
    expect(wrapper.get(testId('skill-review-findings-high')).attributes('open'))
      .toBeDefined()
    expect(wrapper.get(testId('skill-review-findings-low')).attributes('open'))
      .toBeUndefined()
    expect(wrapper.get(testId('skill-review-findings-high')).text())
      .toContain('SKILL.md:2')
  })

  it('marks a quoted mention as probably an example', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [{
            type: 'injection',
            rule: 'injection-override',
            severity: 'low',
            path: 'SKILL.md',
            line: 4,
            snippet: '"disregard the previous instruction"',
            detail: 'quoted, probably an example',
            source: 'rules',
          }],
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-finding-quoted')).text())
      .toBe('(quoted, probably an example)')
  })

  it('never calls a skill clean, verified, trusted or harmless', async () => {
    const withFindings = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })
    const withoutFindings = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ findings: [], findingCounts: {} }),
      },
    })

    for (const wrapper of [withFindings, withoutFindings]) {
      expect(stripMandatedSentences(wrapper.text()))
        .not.toMatch(BANNED_WORDS)
    }
  })

  it('says that no highlight does not mean the text is harmless', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ findings: [], findingCounts: {} }),
      },
    })

    expect(wrapper.get(testId('skill-review-no-highlight-note')).text())
      .toBe(
        'No highlight does not mean the text is harmless. Read the files that matter to you.',
      )
    expect(wrapper.html()).not.toContain('lucide:circle-check')
    expect(wrapper.html()).not.toContain('lucide:shield-check')
  })

  it('lists Look closely first with the path, line and a plain explanation', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [
            makeFinding({
              type: 'url',
              rule: 'url',
              severity: 'low',
              line: 1,
            }),
            makeFinding({
              type: 'execution',
              rule: 'dynamic-context-inline',
              severity: 'high',
              line: 9,
              snippet: '!`gh pr diff`',
            }),
            makeFinding({
              type: 'secret',
              rule: 'env-dump',
              severity: 'medium',
              line: 3,
            }),
          ],
        }),
      },
    })
    const groups = wrapper.findAll(
      '[data-testid^="skill-review-findings-"]',
    ).map((group) => {
      return group.attributes('data-testid')
    })
    const high = wrapper.get(testId('skill-review-findings-high'))

    expect(groups).toEqual([
      'skill-review-findings-high',
      'skill-review-findings-medium',
      'skill-review-findings-low',
    ])
    expect(high.get(testId('skill-review-finding')).text())
      .toContain('SKILL.md:9')
    expect(high.get(testId('skill-review-finding-explanation')).text())
      .toContain(getSkillFindingExplanation('dynamic-context-inline')!)
    expect(high.get(testId('skill-review-finding-explanation')).text())
      .toContain('Besidka never runs')
  })

  it('shows the callout for a highlight in the description', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [
            makeFinding({
              type: 'injection',
              rule: 'injection-override',
              severity: 'high',
              line: 3,
              detail: 'sent with every message while the skill is on Auto',
            }),
            makeFinding({
              type: 'injection',
              rule: 'injection-override',
              severity: 'high',
              line: 20,
            }),
          ],
        }),
      },
    })
    const callouts = wrapper.findAll(testId('skill-review-finding-callout'))

    expect(callouts).toHaveLength(1)
    expect(callouts[0]!.text())
      .toBe('This text is in every message while the skill is on Auto.')
  })

  it('keeps every explanation and callout free of banned words', () => {
    const texts = [
      ...SKILL_TEXT_RULES.map(rule => rule.explanation),
      ...Object.values(EXTRA_FINDING_EXPLANATIONS),
      SKILL_FINDING_CATALOG_CALLOUT,
    ]

    for (const text of texts) {
      expect(text, text).not.toMatch(BANNED_WORDS)
    }
  })

  it('says nothing was highlighted when there are no findings', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ findings: [], findingCounts: {} }),
      },
    })

    expect(wrapper.get(testId('skill-review-finding-counts')).text())
      .toContain('Nothing was highlighted.')
    expect(wrapper.find(testId('skill-review-findings')).exists()).toBe(false)
  })

  it('highlights findings in SKILL.md by line', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    expect(wrapper.findAll(testId('skill-file-line-flagged'))).toHaveLength(1)
    expect(wrapper.get(testId('skill-file-marker')).text()).toBe('Command')
  })

  it('fetches a file the browser does not have, shows it once and never refetches it', async () => {
    const loadFile = vi.fn(async (path: string) => `echo from ${path}`)
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })
    const items = wrapper.findAll(testId('skill-file-tree-item'))

    await items[1]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledWith('scripts/run.sh')
    expect(wrapper.get(testId('skill-file-viewer-lines')).text())
      .toContain('echo from scripts/run.sh')

    await items[0]!.trigger('click')
    await flushPromises()
    await items[1]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('not shown before you install')
  })

  it('shows the plain text with line numbers, the highlight and hidden characters', async () => {
    const loadFile = vi.fn(async () => 'one\ntwo https://x.test\u200bz\nthree')
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')
    await flushPromises()

    const lines = wrapper.findAll('[data-line]')

    expect(lines).toHaveLength(3)
    expect(lines[0]!.text()).toContain('1')
    expect(lines[0]!.attributes('data-testid')).toBe('skill-file-line-flagged')
    expect(lines[1]!.text()).toContain('⟨U+200B⟩')
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it('shows a loading state while the file is on its way', async () => {
    let resolveFile: (text: string) => void = () => undefined
    const loadFile = vi.fn(() => new Promise<string>((resolve) => {
      resolveFile = resolve
    }))
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(wrapper.find(testId('skill-review-file-loading')).exists())
      .toBe(true)

    resolveFile('echo hi')
    await flushPromises()

    expect(wrapper.find(testId('skill-review-file-loading')).exists())
      .toBe(false)
    expect(wrapper.get('code').text()).toBe('echo hi')
  })

  it('says why a file cannot be shown, in plain text', async () => {
    const loadFile = vi.fn(async () => {
      throw { data: {
        message: 'This file is too large to show',
        why: 'The review shows files up to 1 MiB',
      } }
    })
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview(), loadFile },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-review-file-error')).text()).toBe(
      'This file is too large to show. The review shows files up to 1 MiB',
    )
    expect(wrapper.find(testId('skill-file-viewer')).exists()).toBe(false)
  })

  it('ignores a slow answer for a file that is no longer selected', async () => {
    const answers: Record<string, (text: string) => void> = {}
    const loadFile = vi.fn((path: string) => new Promise<string>((resolve) => {
      answers[path] = resolve
    }))
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          files: [
            ...base.files,
            { path: 'references/a.md', bytes: 3, kind: 'reference' },
          ],
        }),
        loadFile,
      },
    })
    const items = wrapper.findAll(testId('skill-file-tree-item'))
    const itemFor = (name: string) => {
      return items.find(item => item.text().includes(name))!
    }

    await itemFor('run.sh').trigger('click')
    await itemFor('a.md').trigger('click')
    answers['references/a.md']!('second file')
    await flushPromises()
    answers['scripts/run.sh']!('first file')
    await flushPromises()

    expect(wrapper.get('code').text()).toBe('second file')
  })

  it('previews another file when the caller can read it', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview(),
        readFile: (path: string) => path === 'scripts/run.sh' ? 'echo hi' : null,
      },
    })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(wrapper.get('code').text()).toBe('echo hi')
  })

  it('opens the file of a finding from the highlights list, scrolls to its line and marks it', async () => {
    const scrollIntoView = vi.fn()

    Element.prototype.scrollIntoView = scrollIntoView

    const loadFile = vi.fn(async () => 'echo a\necho b\nhttps://x.test')
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [{
            type: 'url',
            rule: 'url',
            severity: 'low',
            source: 'rules',
            path: 'scripts/run.sh',
            line: 3,
            snippet: 'https://x.test',
            detail: null,
          }, ...base.findings.slice(0, 1)],
        }),
        loadFile,
      },
    })

    await wrapper.findAll(testId('skill-review-finding'))[0]!.trigger('click')
    await flushPromises()

    expect(loadFile).toHaveBeenCalledWith('scripts/run.sh')
    expect(wrapper.get(testId('skill-file-viewer')).text())
      .toContain('scripts/run.sh')

    const focused = wrapper.get(testId('skill-file-line-focused'))

    expect(focused.attributes('data-line')).toBe('3')
    expect(focused.attributes('aria-current')).toBe('location')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('moves the mark when another highlight of the same file is clicked', async () => {
    Element.prototype.scrollIntoView = vi.fn()

    const loadFile = vi.fn(async () => 'a\nb\nc\nd')
    const base = createImportPreview()
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          findings: [
            { type: 'url', rule: 'url', severity: 'low', source: 'rules', path: 'scripts/run.sh', line: 2, snippet: 'b', detail: null },
            { type: 'url', rule: 'url', severity: 'low', source: 'rules', path: 'scripts/run.sh', line: 4, snippet: 'd', detail: null },
          ],
          files: base.files,
        }),
        loadFile,
      },
    })
    const items = wrapper.findAll(testId('skill-review-finding'))

    await items[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-file-line-focused')).attributes('data-line'))
      .toBe('2')

    await items[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('skill-file-line-focused')).attributes('data-line'))
      .toBe('4')
    expect(loadFile).toHaveBeenCalledTimes(1)
  })

  it('shows archive warnings', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({ warnings: ['Skipped __MACOSX'] }),
      },
    })

    expect(wrapper.get(testId('skill-review-warnings')).text())
      .toContain('Skipped __MACOSX')
  })

  it('labels a license-less skill as no license stated', async () => {
    const wrapper = await mountSuspended(Review, {
      props: {
        preview: createImportPreview({
          license: {
            class: 'none',
            text: 'No license stated.',
            matched: [],
            file: null,
            spdx: null,
            licenseText: null,
            licenseField: null,
          },
          requiresLicenseAcknowledgement: true,
        }),
      },
    })

    expect(wrapper.get(testId('skill-review-license-class')).text())
      .toBe('No license stated')
    expect(wrapper.find(testId('skill-review-license-text')).exists())
      .toBe(false)
  })
})

const JEV_BANNED_COPY = /\b(?:clean|no issues|verified|harmless|passed|all clear)\b|[✓✔]/i

function jevResponse(overrides: Record<string, unknown> = {}) {
  return {
    state: 'screened',
    questionSetVersion: 1,
    status: 'ok',
    findings: [],
    marks: [],
    unchecked: [],
    tooLarge: false,
    calls: 1,
    callsSpent: 1,
    callsLeft: 47,
    ...overrides,
  }
}

const SEND_OUT_MARK = {
  path: 'references/setup.md',
  startLine: 40,
  endLine: 92,
  question: 'k1_send_out',
  rule: 'jev-send-out',
  severity: 'high',
  score: 0.9,
}

const SEND_OUT_FINDING: SkillFinding = {
  type: 'exfiltration',
  rule: 'jev-send-out',
  severity: 'high',
  path: 'references/setup.md',
  line: 40,
  snippet: '',
  detail: 'TypeSafe AI, lines 40 to 92',
  source: 'jev',
}

async function mountJev(response: unknown) {
  mocks.fetch.mockResolvedValue(response)

  const preview = createImportPreview({ jev: 'available' })
  const wrapper = await mountSuspended(Review, { props: { preview } })

  await flushPromises()

  return { wrapper, preview }
}

describe('Profile/Skills/Review: TypeSafe AI section', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('makes no request and shows no section without the available flag', async () => {
    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })

    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(wrapper.find(testId('skill-jev-section')).exists()).toBe(false)
  })

  it('posts an empty body to the stage route when the review opens', async () => {
    const { preview } = await mountJev(jevResponse())

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/v1/skills/import/${preview.stageId}/screen`,
      { method: 'POST', body: {} },
    )
  })

  it('hides the section when the answer is unavailable', async () => {
    const { wrapper } = await mountJev(jevResponse({ state: 'unavailable' }))

    expect(wrapper.find(testId('skill-jev-section')).exists()).toBe(false)
  })

  it('shows Checking… while the request is open', async () => {
    mocks.fetch.mockReturnValue(new Promise(() => undefined))

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview({ jev: 'available' }) },
    })

    await flushPromises()

    expect(wrapper.get(testId('skill-jev-checking')).text()).toBe('Checking…')
    expect(wrapper.get(testId('skill-jev-section')).text())
      .not.toMatch(JEV_BANNED_COPY)
  })

  it('names the marks and merges them into the same groups with a TypeSafe AI badge', async () => {
    const { wrapper, preview } = await mountJev(jevResponse({
      marks: [SEND_OUT_MARK],
      findings: [SEND_OUT_FINDING],
    }))
    const high = wrapper.get(testId('skill-review-findings-high'))

    expect(wrapper.get(testId('skill-jev-marked')).text()).toBe(
      'Marked 1 passage: asks to send data out (references/setup.md lines '
      + '40 to 92).',
    )
    expect(high.text()).toContain('Look closely')
    expect(high.get(testId('skill-review-finding-source')).text())
      .toBe('TypeSafe AI')
    expect(high.get(testId('skill-review-finding-source')).classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-soft']))
    expect(wrapper.get(testId('skill-review-finding-counts')).text())
      .not.toContain('TypeSafe')
    expect(preview.findings.every(finding => finding.source === 'rules'))
      .toBe(true)
    expect(wrapper.get(testId('skill-jev-section')).text())
      .not.toMatch(JEV_BANNED_COPY)
    expect(high.text()).not.toMatch(JEV_BANNED_COPY)
  })

  it('keeps every rule finding when the marks arrive', async () => {
    const withoutJev = await mountSuspended(Review, {
      props: { preview: createImportPreview() },
    })
    const ruleCount = withoutJev
      .findAll(testId('skill-review-finding')).length
    const { wrapper } = await mountJev(jevResponse({
      marks: [SEND_OUT_MARK],
      findings: [SEND_OUT_FINDING],
    }))

    expect(wrapper.findAll(testId('skill-review-finding')).length)
      .toBe(ruleCount + 1)
  })

  it('says Checked all parts when nothing was marked, and never a verdict', async () => {
    const { wrapper } = await mountJev(jevResponse())

    expect(wrapper.get(testId('skill-jev-all-parts')).text())
      .toBe('Checked all parts.')
    expect(wrapper.get(testId('skill-jev-section')).text())
      .not.toMatch(JEV_BANNED_COPY)
    expect(wrapper.get(testId('skill-review-no-highlight-note')).text())
      .toContain('No highlight does not mean')
  })

  it('offers Check the rest and posts { rest: true } only on click', async () => {
    const { wrapper, preview } = await mountJev(jevResponse({
      unchecked: [{ path: 'references/big.md', startLine: 1, endLine: 400 }],
    }))

    expect(wrapper.get(testId('skill-jev-unchecked-text')).text())
      .toBe('Not checked: 1 part.')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    mocks.fetch.mockResolvedValue(jevResponse({ callsLeft: 46 }))
    await wrapper.get(testId('skill-jev-check-rest')).trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      `/api/v1/skills/import/${preview.stageId}/screen`,
      { method: 'POST', body: { rest: true } },
    )
    expect(wrapper.find(testId('skill-jev-check-rest')).exists()).toBe(false)
  })

  it('hides Check the rest when the review budget is spent', async () => {
    const { wrapper } = await mountJev(jevResponse({
      unchecked: [{ path: 'references/big.md', startLine: 1, endLine: 400 }],
      callsLeft: 0,
    }))

    expect(wrapper.find(testId('skill-jev-check-rest')).exists()).toBe(false)
    expect(wrapper.get(testId('skill-jev-budget')).exists()).toBe(true)
  })

  it('says Did not finish when TypeSafe AI failed, and keeps the review usable', async () => {
    const { wrapper } = await mountJev(jevResponse({
      status: 'timeout',
      unchecked: [
        { path: 'a.md', startLine: 1, endLine: 5 },
        { path: 'b.md', startLine: 1, endLine: 5 },
      ],
    }))

    expect(wrapper.get(testId('skill-jev-failed-text')).text()).toBe(
      'Did not finish: TypeSafe AI did not answer. 2 parts not checked.',
    )
    expect(wrapper.find(testId('skill-review-findings')).exists()).toBe(true)
  })

  it('says Did not finish when the request itself fails', async () => {
    mocks.fetch.mockRejectedValue({
      statusCode: 429,
      data: { message: 'Too many checks this hour' },
    })

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview({ jev: 'available' }) },
    })

    await flushPromises()

    expect(wrapper.get(testId('skill-jev-failed-text')).text())
      .toContain('Did not finish:')
  })

  it('retries while another request holds the check, then says it is still checking', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockResolvedValue(jevResponse({ state: 'in-progress' }))

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview({ jev: 'available' }) },
    })

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.find(testId('skill-jev-checking')).exists()).toBe(true)

    for (let attempt = 0; attempt < 5; attempt++) {
      await vi.advanceTimersByTimeAsync(2000)
    }

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(6)
    expect(wrapper.get(testId('skill-jev-still-checking')).text())
      .toContain('Still checking')
  })

  it('shows the result of a retry once the first request has finished', async () => {
    vi.useFakeTimers()
    mocks.fetch
      .mockResolvedValueOnce(jevResponse({ state: 'in-progress' }))
      .mockResolvedValueOnce(jevResponse())

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview({ jev: 'available' }) },
    })

    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.get(testId('skill-jev-all-parts')).exists()).toBe(true)
  })

  it('treats a malformed answer as unavailable', async () => {
    const { wrapper } = await mountJev(undefined)

    expect(wrapper.find(testId('skill-jev-section')).exists()).toBe(false)
  })

  it('drops an answer that arrives after the screen closed', async () => {
    let resolve: (value: unknown) => void = () => undefined

    mocks.fetch.mockReturnValue(new Promise((done) => {
      resolve = done
    }))

    const wrapper = await mountSuspended(Review, {
      props: { preview: createImportPreview({ jev: 'available' }) },
    })

    await flushPromises()
    wrapper.unmount()
    resolve(jevResponse({ marks: [SEND_OUT_MARK] }))
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
