import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import FindingGroups from '../../../../../app/components/Profile/Skills/FindingGroups.vue'
import type { SkillFinding } from '../../../../../shared/utils/skills/findings'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function makeFinding(overrides: Partial<SkillFinding>): SkillFinding {
  return {
    type: 'url',
    rule: 'url',
    severity: 'low',
    path: 'references/setup.md',
    line: 12,
    snippet: 'https://x.test',
    detail: null,
    source: 'rules',
    ...overrides,
  }
}

describe('Profile/Skills/FindingGroups', () => {
  it('renders nothing without findings', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: { findings: [] },
    })

    expect(wrapper.find(testId('skill-review-findings')).exists()).toBe(false)
  })

  it('opens Look closely and Worth a look and collapses For your information', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: {
        findings: [
          makeFinding({ severity: 'low' }),
          makeFinding({ severity: 'medium', rule: 'env-dump', type: 'secret' }),
          makeFinding({
            severity: 'high',
            rule: 'concealment',
            type: 'concealment',
          }),
        ],
      },
    })

    expect(wrapper.get(testId('skill-review-findings-high')).attributes('open'))
      .toBeDefined()
    expect(
      wrapper.get(testId('skill-review-findings-medium')).attributes('open'),
    ).toBeDefined()
    expect(wrapper.get(testId('skill-review-findings-low')).attributes('open'))
      .toBeUndefined()
  })

  it('shows the explanation, the rule detail and a text label for the kind', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: {
        findings: [makeFinding({
          severity: 'high',
          rule: 'markdown-image-query',
          type: 'exfiltration',
          detail: 'sends text to evil.example',
        })],
      },
    })

    expect(wrapper.get(testId('skill-review-finding-marker')).text())
      .toBe('Sends data out')
    expect(wrapper.get(testId('skill-review-finding-explanation')).text())
      .toContain('An image link with data in its address.')
    expect(wrapper.get(testId('skill-review-finding-detail')).text())
      .toBe('sends text to evil.example')
    expect(wrapper.get(testId('skill-review-finding')).text())
      .toContain('references/setup.md:12')
  })

  it('marks a quoted mention and keeps the quoted detail out of the explanation', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: {
        findings: [makeFinding({
          severity: 'low',
          rule: 'injection-override',
          type: 'injection',
          detail: 'quoted, probably an example',
        })],
      },
    })

    expect(wrapper.get(testId('skill-review-finding-quoted')).text())
      .toBe('(quoted, probably an example)')
    expect(wrapper.find(testId('skill-review-finding-detail')).exists())
      .toBe(false)
  })

  it('emits the path and line when a finding is selected', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: { findings: [makeFinding({ severity: 'high' })] },
    })

    await wrapper.get(testId('skill-review-finding')).trigger('click')

    expect(wrapper.emitted('select')).toEqual([['references/setup.md', 12]])
  })

  it('shows only the line, and no button, in the editor', async () => {
    const wrapper = await mountSuspended(FindingGroups, {
      props: {
        findings: [makeFinding({ severity: 'high' })],
        isSelectable: false,
        showPath: false,
      },
    })
    const item = wrapper.get(testId('skill-review-finding'))

    expect(item.element.tagName).toBe('DIV')
    expect(item.text()).toContain('Line 12')
    expect(item.text()).not.toContain('references/setup.md')
  })
})
