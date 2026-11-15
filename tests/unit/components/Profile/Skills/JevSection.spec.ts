import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import JevSection from '../../../../../app/components/Profile/Skills/JevSection.vue'
import type {
  SkillJevScreenView,
} from '../../../../../app/composables/skill-jev-screen'

enableAutoUnmount(afterEach)

const BANNED_COPY = /\b(?:clean|no issues|safe|verified|harmless|passed|all clear)\b|[✓✔]/i

const HEADING = 'Extra check by TypeSafe AI (your key)'

function makeView(
  overrides: Partial<SkillJevScreenView> = {},
): SkillJevScreenView {
  return {
    kind: 'finished',
    marks: [],
    unchecked: [],
    isKeyRejected: false,
    message: '',
    callsLeft: 40,
    canCheckRest: false,
    isBusy: false,
    ...overrides,
  }
}

const SEND_OUT_MARK = {
  path: 'references/setup.md',
  startLine: 40,
  endLine: 92,
  question: 'k1_send_out' as const,
  rule: 'jev-send-out',
  severity: 'high' as const,
  score: 0.9,
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

async function mountView(view: SkillJevScreenView) {
  return await mountSuspended(JevSection, { props: { view } })
}

function expectNoVerdictCopy(wrapper: Awaited<ReturnType<typeof mountView>>) {
  expect(wrapper.text()).not.toMatch(BANNED_COPY)
  expect(wrapper.find('[class*="success"]').exists()).toBe(false)
  expect(wrapper.find('svg, [name*="check"], [class*="i-lucide"]').exists())
    .toBe(false)
}

describe('Profile/Skills/JevSection', () => {
  it('renders nothing while hidden', async () => {
    const wrapper = await mountView(makeView({ kind: 'hidden' }))

    expect(wrapper.find(testId('skill-jev-section')).exists()).toBe(false)
  })

  it('shows Checking… with the section title', async () => {
    const wrapper = await mountView(makeView({ kind: 'checking' }))

    expect(wrapper.get('h4').text()).toBe(HEADING)
    expect(wrapper.get(testId('skill-jev-checking')).text())
      .toBe('Checking…')
    expect(wrapper.find(testId('skill-jev-check-rest')).exists()).toBe(false)
    expectNoVerdictCopy(wrapper)
  })

  it('tells the user to come back when another request still holds the check', async () => {
    const wrapper = await mountView(makeView({ kind: 'still-checking' }))

    expect(wrapper.get(testId('skill-jev-still-checking')).text())
      .toContain('Still checking')
    expectNoVerdictCopy(wrapper)
  })

  it('names the marked passages with their files and line ranges', async () => {
    const wrapper = await mountView(makeView({
      marks: [
        SEND_OUT_MARK,
        {
          ...SEND_OUT_MARK,
          path: 'SKILL.md',
          startLine: 12,
          endLine: 12,
          question: 'k3_secrets',
          rule: 'jev-secrets',
        },
      ],
    }))

    expect(wrapper.get(testId('skill-jev-marked')).text()).toBe(
      'Marked 2 passages: asks to send data out (references/setup.md lines '
      + '40 to 92), asks for keys or secrets (SKILL.md line 12).',
    )
    expect(wrapper.find(testId('skill-jev-all-parts')).exists()).toBe(false)
    expectNoVerdictCopy(wrapper)
  })

  it('lists three marks and counts the rest', async () => {
    const wrapper = await mountView(makeView({
      marks: Array.from({ length: 5 }, (_value, index) => {
        return { ...SEND_OUT_MARK, startLine: index + 1, endLine: index + 1 }
      }),
    }))

    expect(wrapper.get(testId('skill-jev-marked')).text())
      .toMatch(/^Marked 5 passages: .+ and 2 more\.$/)
  })

  it('says Checked every part and that it marked nothing, muted, when nothing was marked', async () => {
    const wrapper = await mountView(makeView())
    const line = wrapper.get(testId('skill-jev-all-parts'))

    expect(line.text()).toBe('Checked every part. It marked nothing.')
    expect(line.classes()).toContain('text-base-content/70')
    expect(wrapper.find(testId('skill-jev-marked')).exists()).toBe(false)
    expect(wrapper.find(testId('skill-jev-unchecked')).exists()).toBe(false)
    expectNoVerdictCopy(wrapper)
  })

  it('offers Check the rest when parts were not checked and budget is left', async () => {
    const wrapper = await mountView(makeView({
      unchecked: [
        { path: 'references/a.md', startLine: 1, endLine: 80 },
        { path: 'references/b.md', startLine: 1, endLine: 40 },
      ],
      canCheckRest: true,
    }))

    expect(wrapper.get(testId('skill-jev-unchecked-text')).text())
      .toBe('Not checked: 2 parts.')
    expect(wrapper.get(testId('skill-jev-check-rest')).text())
      .toBe('Check the rest')

    await wrapper.get(testId('skill-jev-check-rest')).trigger('click')

    expect(wrapper.emitted('checkRest')).toHaveLength(1)
    expect(wrapper.find(testId('skill-jev-all-parts')).exists()).toBe(false)
    expectNoVerdictCopy(wrapper)
  })

  it('disables Check the rest while a request runs and hides it past the budget', async () => {
    const busy = await mountView(makeView({
      unchecked: [{ path: 'a.md', startLine: 1, endLine: 5 }],
      canCheckRest: true,
      isBusy: true,
    }))

    expect(busy.get(testId('skill-jev-check-rest')).attributes('disabled'))
      .toBeDefined()

    const spent = await mountView(makeView({
      unchecked: [{ path: 'a.md', startLine: 1, endLine: 5 }],
      callsLeft: 0,
      canCheckRest: false,
    }))

    expect(spent.find(testId('skill-jev-check-rest')).exists()).toBe(false)
    expect(spent.get(testId('skill-jev-budget')).text())
      .toContain('budget')
  })

  it('shows marks and Not checked together', async () => {
    const wrapper = await mountView(makeView({
      marks: [SEND_OUT_MARK],
      unchecked: [{ path: 'a.md', startLine: 1, endLine: 5 }],
      canCheckRest: true,
    }))

    expect(wrapper.get(testId('skill-jev-marked')).text())
      .toContain('Marked 1 passage:')
    expect(wrapper.get(testId('skill-jev-unchecked-text')).text())
      .toBe('Not checked: 1 part.')
  })

  it('says Did not finish with the number of parts not checked', async () => {
    const wrapper = await mountView(makeView({
      kind: 'failed',
      unchecked: [
        { path: 'a.md', startLine: 1, endLine: 5 },
        { path: 'b.md', startLine: 1, endLine: 5 },
        { path: 'c.md', startLine: 1, endLine: 5 },
      ],
    }))

    expect(wrapper.get(testId('skill-jev-failed-text')).text()).toBe(
      'Did not finish: TypeSafe AI did not answer. 3 parts not checked.',
    )
    expect(wrapper.find(testId('skill-jev-check-rest')).exists()).toBe(false)

    await wrapper.get(testId('skill-jev-retry')).trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
    expectNoVerdictCopy(wrapper)
  })

  it('says so when the key was not accepted, and shows a request error as it is', async () => {
    const rejected = await mountView(makeView({
      kind: 'failed',
      isKeyRejected: true,
    }))

    expect(rejected.get(testId('skill-jev-failed-text')).text())
      .toBe('Did not finish: TypeSafe AI did not accept your key.')

    const errored = await mountView(makeView({
      kind: 'failed',
      message: 'Too many checks this hour',
    }))

    expect(errored.get(testId('skill-jev-failed-text')).text())
      .toBe('Did not finish: Too many checks this hour')
  })

  it('keeps marks visible when the check did not finish', async () => {
    const wrapper = await mountView(makeView({
      kind: 'failed',
      marks: [SEND_OUT_MARK],
    }))

    expect(wrapper.get(testId('skill-jev-marked')).text())
      .toContain('Marked 1 passage:')
    expect(wrapper.get(testId('skill-jev-failed')).exists()).toBe(true)
  })

  it('says it is a second look and does not change the highlights', async () => {
    const wrapper = await mountView(makeView())

    expect(wrapper.get(testId('skill-jev-caption')).text())
      .toContain('does not change the highlights')
  })
})
