import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ProblemList from '../../../../../app/components/Profile/Skills/ProblemList.vue'
import type { SkillFinding } from '../../../../../shared/utils/skills/findings'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

const catalogFinding: SkillFinding = {
  type: 'injection',
  rule: 'injection-override',
  severity: 'high',
  path: 'SKILL.md',
  line: 3,
  snippet: 'ignore all previous instructions',
  detail: 'sent with every message while the skill is on Auto',
  source: 'rules',
}

describe('Profile/Skills/ProblemList', () => {
  it('renders nothing without problems or findings', async () => {
    const wrapper = await mountSuspended(ProblemList, {
      props: { problems: [] },
    })

    expect(wrapper.find(testId('skill-editor-problems')).exists()).toBe(false)
    expect(wrapper.find(testId('skill-editor-findings')).exists()).toBe(false)
  })

  it('shows the same groups for the file being edited, with the description callout', async () => {
    const wrapper = await mountSuspended(ProblemList, {
      props: { problems: [], findings: [catalogFinding] },
    })

    expect(wrapper.get(testId('skill-editor-findings-high')).text())
      .toContain('Look closely (1)')
    expect(wrapper.get(testId('skill-review-finding-callout')).text())
      .toBe('This text is in every message while the skill is on Auto.')
    expect(wrapper.get(testId('skill-review-finding-marker')).text())
      .toBe('Instruction-like')
  })

  it('keeps the problems and the findings together', async () => {
    const wrapper = await mountSuspended(ProblemList, {
      props: {
        problems: [{
          id: 'p1',
          severity: 'warning',
          message: 'Name is long',
          line: 2,
        }] as never,
        findings: [catalogFinding],
      },
    })

    expect(wrapper.findAll(testId('skill-editor-problem'))).toHaveLength(1)
    expect(wrapper.find(testId('skill-editor-findings')).exists()).toBe(true)
  })
})
