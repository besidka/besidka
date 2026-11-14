import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkillSummary } from '../../../../../shared/types/skills.d'
import SkillRow from '../../../../../app/components/Profile/Skills/Row.vue'
import { createSkillSummary } from '../../../../setup/helpers/skills-ui'

enableAutoUnmount(afterEach)

function mountRow(
  skill: SkillSummary,
  props: Record<string, unknown> = {},
) {
  return mountSuspended(SkillRow, {
    props: { skill, ...props },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/Row', () => {
  it('shows the name, the description and the Skill badge as plain text', async () => {
    const wrapper = await mountRow(createSkillSummary({
      description: '<img src=x onerror=alert(1)> Review a pull request',
    }))

    expect(wrapper.get(testId('skill-row-open')).text()).toBe('review-pr')
    expect(wrapper.get(testId('skill-row-description')).text())
      .toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get(testId('skill-row-kind')).text()).toBe('Skill')
  })

  it('shows /name for a slash command with both badges when it is both', async () => {
    const wrapper = await mountRow(createSkillSummary({
      slashCommand: true,
      modelInvocable: true,
    }))

    expect(wrapper.get(testId('skill-row-open')).text()).toBe('/review-pr')
    expect(wrapper.findAll(testId('skill-row-kind')).map(badge => badge.text()))
      .toEqual(['Skill', 'Command'])
  })

  it('shows the Off badge for a skill that is switched off', async () => {
    const wrapper = await mountRow(createSkillSummary({ enabled: false }))

    expect(wrapper.get(testId('skill-row-status')).text()).toBe('Off')
  })

  it('shows Needs review and a pending update badge', async () => {
    const wrapper = await mountRow(createSkillSummary({
      status: 'needs-review',
      pendingVersion: 8,
    }))

    expect(wrapper.get(testId('skill-row-status')).text())
      .toBe('Needs review')
    expect(wrapper.find(testId('skill-row-pending')).exists()).toBe(true)
  })

  it('explains a broken skill and disables its toggle', async () => {
    const wrapper = await mountRow(createSkillSummary({ status: 'broken' }))

    expect(wrapper.get(testId('skill-row-status')).text()).toBe('Broken')
    expect(wrapper.get(testId('skill-row-broken')).text())
      .toBe('Files are missing. Restore an earlier version or delete it.')
    expect(wrapper.get(testId('skill-row-toggle')).attributes('disabled'))
      .toBeDefined()
  })

  it('shows the version and the source in the meta line', async () => {
    const wrapper = await mountRow(createSkillSummary({
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourcePath: 'skills/x',
      sourceVersion: 'abcdef1234567890',
    }))

    expect(wrapper.get(testId('skill-row-meta')).text())
      .toContain('github.com/o/r/skills/x @ abcdef1 · v7')
  })

  it('shows the token estimate only for model-invocable skills', async () => {
    const invocable = await mountRow(createSkillSummary())
    const commandOnly = await mountRow(createSkillSummary({
      modelInvocable: false,
      slashCommand: true,
    }))

    expect(invocable.get(testId('skill-row-tokens')).text())
      .toMatch(/^≈ \d+ tokens in every message$/)
    expect(commandOnly.find(testId('skill-row-tokens')).exists()).toBe(false)
  })

  it('emits toggle with the next state without flipping the checkbox itself', async () => {
    const wrapper = await mountRow(createSkillSummary({ enabled: true }))
    const toggle = wrapper.get(testId('skill-row-toggle'))

    await toggle.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]?.[1]).toBe(false)
    expect((toggle.element as HTMLInputElement).checked).toBe(true)
  })

  it('opens the detail on a click and the versions tab from the menu', async () => {
    const wrapper = await mountRow(createSkillSummary())

    await wrapper.get(testId('skill-row-open')).trigger('click')
    await wrapper.get(testId('skill-action-versions')).trigger('click')

    expect(wrapper.emitted('open')?.map(call => call[1])).toEqual([
      'instructions',
      'versions',
    ])
  })

  it('offers Check for updates only for GitHub skills with the import flag', async () => {
    const github = createSkillSummary({ sourceKind: 'github' })

    expect((await mountRow(github, { canImportFromUrl: true }))
      .find(testId('skill-action-check-updates')).exists()).toBe(true)
    expect((await mountRow(github, { canImportFromUrl: false }))
      .find(testId('skill-action-check-updates')).exists()).toBe(false)
    expect((await mountRow(createSkillSummary(), { canImportFromUrl: true }))
      .find(testId('skill-action-check-updates')).exists()).toBe(false)
  })

  it('offers Review update only when an update is pending and never Share or Use in new chat', async () => {
    const pending = await mountRow(createSkillSummary({ pendingVersion: 9 }))
    const plain = await mountRow(createSkillSummary())

    expect(pending.find(testId('skill-action-review-update')).exists())
      .toBe(true)
    expect(plain.find(testId('skill-action-review-update')).exists())
      .toBe(false)
    expect(plain.get(testId('skill-row-actions-menu')).text())
      .not.toMatch(/share|use in new chat/i)
  })

  it('links the download to the archive endpoint', async () => {
    const wrapper = await mountRow(createSkillSummary())

    expect(wrapper.get(testId('skill-action-download')).attributes('href'))
      .toBe('/api/v1/skills/SkillPublicId01/download')
  })
})
