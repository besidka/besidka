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

  it('shows /name only for a command, which is a skill that runs only when asked', async () => {
    const wrapper = await mountRow(createSkillSummary({
      slashCommand: true,
      modelInvocable: false,
    }))

    expect(wrapper.get(testId('skill-row-open')).text()).toBe('/review-pr')
    expect(wrapper.findAll(testId('skill-row-kind')).map(badge => badge.text()))
      .toEqual(['Command'])

    const auto = await mountRow(createSkillSummary({
      slashCommand: true,
      modelInvocable: true,
    }))

    expect(auto.get(testId('skill-row-open')).text()).toBe('review-pr')
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

  it('explains a broken skill and disables its mode control', async () => {
    const wrapper = await mountRow(createSkillSummary({ status: 'broken' }))

    expect(wrapper.get(testId('skill-row-status')).text()).toBe('Broken')
    expect(wrapper.get(testId('skill-row-broken')).text())
      .toBe('Files are missing. Restore an earlier version or delete it.')
    expect(wrapper.get(testId('skill-row-mode-select')).attributes('disabled'))
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

  it('shows no token estimate for an Auto skill that is switched off', async () => {
    const wrapper = await mountRow(createSkillSummary({
      enabled: false,
      modelInvocable: true,
    }))

    expect(wrapper.find(testId('skill-row-tokens')).exists()).toBe(false)
  })

  it('shows the mode and emits the chosen mode without changing it itself', async () => {
    const skill = createSkillSummary({
      enabled: true,
      modelInvocable: true,
      slashCommand: true,
    })
    const wrapper = await mountRow(skill)
    const select = wrapper.get(testId('skill-row-mode-select'))
      .element as HTMLSelectElement

    expect(select.value).toBe('auto')
    expect([...select.options].map(option => option.textContent?.trim()))
      .toEqual(['Off', 'Auto', 'Only when I ask'])

    select.value = 'ask'
    select.dispatchEvent(new Event('change'))

    expect(wrapper.emitted('setMode')).toEqual([[skill, 'ask']])
    expect(select.value).toBe('auto')
  })

  it('reads Off, Auto and Only when I ask from the three columns', async () => {
    const off = await mountRow(createSkillSummary({ enabled: false }))
    const ask = await mountRow(createSkillSummary({
      enabled: true,
      modelInvocable: false,
      slashCommand: true,
    }))

    expect((off.get(testId('skill-row-mode-select')).element as HTMLSelectElement).value)
      .toBe('off')
    expect((ask.get(testId('skill-row-mode-select')).element as HTMLSelectElement).value)
      .toBe('ask')
  })

  it('says to rename a reserved name that cannot run as /name', async () => {
    const blocked = await mountRow(createSkillSummary({
      name: 'memory',
      enabled: true,
      modelInvocable: true,
      slashCommand: false,
    }))
    const fine = await mountRow(createSkillSummary({
      enabled: true,
      slashCommand: true,
    }))

    expect(blocked.get(testId('skill-row-slash-blocked')).text())
      .toBe('Rename to use /name')
    expect(fine.find(testId('skill-row-slash-blocked')).exists()).toBe(false)
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

  it('offers Edit first in the menu and emits the skill', async () => {
    const skill = createSkillSummary()
    const wrapper = await mountRow(skill)

    expect(wrapper.get(`${testId('skill-row-actions-menu')} li button`)
      .attributes('data-testid')).toBe('skill-action-edit')

    await wrapper.get(testId('skill-action-edit')).trigger('click')

    expect(wrapper.emitted('edit')).toEqual([[skill]])
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
