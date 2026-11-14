import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSkillKindOptions,
  buildSkillSourceOptions,
  estimateSkillCatalogTokens,
  filterSkills,
  formatSkillSource,
  getSkillDisplayName,
  getSkillKindLabels,
  isSkillKind,
  parseSkillKindFilter,
  parseSkillSourceFilter,
  requiresEnableConfirmation,
  useSkillActions,
} from '../../../app/composables/skills-library'
import { createSkillSummary } from '../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  refreshNuxtData: vi.fn(),
  errorMessage: vi.fn(),
  successMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)

const counts = {
  sources: { all: 5, created: 3, imported: 2, apps: 0 },
  kinds: { all: 5, skills: 4, commands: 2 },
}

describe('skills-library helpers', () => {
  it('lists only the source groups the user has, after All sources', () => {
    expect(buildSkillSourceOptions(counts)).toEqual([
      { value: 'all', label: 'All sources', count: 5 },
      { value: 'created', label: 'Created', count: 3 },
      { value: 'imported', label: 'Imported', count: 2 },
    ])
  })

  it('hides the source row when only one group exists', () => {
    expect(buildSkillSourceOptions({
      sources: { all: 3, created: 3, imported: 0, apps: 0 },
      kinds: counts.kinds,
    })).toEqual([])
    expect(buildSkillSourceOptions(null)).toEqual([])
  })

  it('uses the server total for All kinds, because a skill can be both', () => {
    const options = buildSkillKindOptions(counts)

    expect(options.map(option => option.value)).toEqual([
      'all',
      'skills',
      'commands',
    ])
    expect(options[0]!.count).toBe(5)
    expect(options[1]!.count + options[2]!.count).toBeGreaterThan(5)
  })

  it('hides the kind row when only one kind exists', () => {
    expect(buildSkillKindOptions({
      sources: counts.sources,
      kinds: { all: 3, skills: 3, commands: 0 },
    })).toEqual([])
  })

  it('mirrors the server rule for kinds: Auto is a skill, Only when I ask a command', () => {
    const auto = createSkillSummary({
      modelInvocable: true,
      slashCommand: true,
    })
    const commandOnly = createSkillSummary({
      modelInvocable: false,
      slashCommand: true,
    })
    const plain = createSkillSummary({
      modelInvocable: false,
      slashCommand: false,
    })

    expect(isSkillKind(auto, 'skills')).toBe(true)
    expect(isSkillKind(auto, 'commands')).toBe(false)
    expect(isSkillKind(commandOnly, 'skills')).toBe(false)
    expect(isSkillKind(commandOnly, 'commands')).toBe(true)
    expect(isSkillKind(plain, 'skills')).toBe(true)
    expect(getSkillKindLabels(auto)).toEqual(['Skill'])
    expect(getSkillKindLabels(commandOnly)).toEqual(['Command'])
    expect(getSkillDisplayName(auto)).toBe('review-pr')
    expect(getSkillDisplayName(commandOnly)).toBe('/review-pr')
  })

  it('filters by source, kind and search text', () => {
    const skills = [
      createSkillSummary({ id: 'a', name: 'alpha', sourceKind: 'editor' }),
      createSkillSummary({
        id: 'b',
        name: 'beta',
        description: 'Translate text',
        sourceKind: 'github',
      }),
      createSkillSummary({
        id: 'c',
        name: 'gamma',
        sourceKind: 'mcp',
        modelInvocable: false,
        slashCommand: true,
      }),
    ]

    const ids = (input: Parameters<typeof filterSkills>[1]) => {
      return filterSkills(skills, input).map(skill => skill.id)
    }

    expect(ids({ source: 'all', kind: 'all', query: '' })).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(ids({ source: 'imported', kind: 'all', query: '' })).toEqual(['b'])
    expect(ids({ source: 'apps', kind: 'commands', query: '' })).toEqual(['c'])
    expect(ids({ source: 'all', kind: 'skills', query: 'TRANSLATE' }))
      .toEqual(['b'])
  })

  it('parses unknown filter values to all', () => {
    expect(parseSkillSourceFilter('imported')).toBe('imported')
    expect(parseSkillSourceFilter('bogus')).toBe('all')
    expect(parseSkillKindFilter('commands')).toBe('commands')
    expect(parseSkillKindFilter(['x'])).toBe('all')
  })

  it('shows /name only when the skill is a slash command', () => {
    expect(getSkillDisplayName({ name: 'x', slashCommand: true })).toBe('/x')
    expect(getSkillDisplayName({ name: 'x', slashCommand: false })).toBe('x')
  })

  it('describes the source of each kind of skill', () => {
    expect(formatSkillSource(createSkillSummary())).toBe('Created by you')
    expect(formatSkillSource(createSkillSummary({ sourceKind: 'zip' })))
      .toBe('Uploaded file')
    expect(formatSkillSource(createSkillSummary({
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourcePath: 'skills/x',
      sourceVersion: 'abcdef1234567890',
    }))).toBe('github.com/o/r/skills/x @ abcdef1')
    expect(formatSkillSource(createSkillSummary({ sourceKind: 'mcp' })))
      .toBe('Added by a connected app')
  })

  it('estimates the catalog line in tokens', () => {
    const tokens = estimateSkillCatalogTokens(createSkillSummary())

    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(60)
  })

  it('asks for confirmation only for skills the user did not write', () => {
    expect(requiresEnableConfirmation({ sourceKind: 'editor' })).toBe(false)
    expect(requiresEnableConfirmation({ sourceKind: 'template' })).toBe(false)
    expect(requiresEnableConfirmation({ sourceKind: 'zip' })).toBe(true)
    expect(requiresEnableConfirmation({ sourceKind: 'github' })).toBe(true)
    expect(requiresEnableConfirmation({ sourceKind: 'mcp' })).toBe(true)
  })
})

describe('useSkillActions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.refreshNuxtData.mockReset()
    mocks.errorMessage.mockReset()
    mocks.successMessage.mockReset()
    mocks.fetch.mockResolvedValue({})
  })

  it('turns on a skill the user wrote without asking', async () => {
    const skill = createSkillSummary({ enabled: false })

    await expect(useSkillActions().setMode(skill, 'auto')).resolves.toBe(true)

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(`/api/v1/skills/${skill.id}`, {
      method: 'PATCH',
      body: { mode: 'auto' },
    })
  })

  it('asks before turning on an imported skill and stops on decline', async () => {
    mocks.confirm.mockResolvedValue(null)

    const skill = createSkillSummary({ sourceKind: 'zip', enabled: false })

    await expect(useSkillActions().setMode(skill, 'ask')).resolves.toBe(false)

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('turns on an imported skill after the user confirms', async () => {
    mocks.confirm.mockResolvedValue({ label: 'Turn on', index: 0 })

    const skill = createSkillSummary({ sourceKind: 'github', enabled: false })

    await expect(useSkillActions().setMode(skill, 'auto')).resolves.toBe(true)

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('asks again for a skill that is already on only when it comes from Off', async () => {
    const skill = createSkillSummary({ sourceKind: 'zip', enabled: true })

    await useSkillActions().setMode(skill, 'ask')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(`/api/v1/skills/${skill.id}`, {
      method: 'PATCH',
      body: { mode: 'ask' },
    })
  })

  it('never asks when turning a skill off', async () => {
    const skill = createSkillSummary({ sourceKind: 'mcp' })

    await useSkillActions().setMode(skill, 'off')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(`/api/v1/skills/${skill.id}`, {
      method: 'PATCH',
      body: { mode: 'off' },
    })
  })

  it('reports a failed save and reloads the list', async () => {
    mocks.fetch.mockRejectedValue({
      data: { message: 'This skill cannot be enabled', why: 'Broken' },
    })

    const result = await useSkillActions().saveSettings('id', { mode: 'auto' })

    expect(result).toBe(false)
    expect(mocks.errorMessage).toHaveBeenCalled()
    expect(mocks.refreshNuxtData).toHaveBeenCalled()
  })

  it('deletes only after a confirmation', async () => {
    mocks.confirm.mockResolvedValueOnce(null)

    const skill = createSkillSummary()

    await expect(useSkillActions().deleteSkill(skill)).resolves.toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValueOnce({ label: 'Delete', index: 0 })

    await expect(useSkillActions().deleteSkill(skill)).resolves.toBe(true)
    expect(mocks.fetch).toHaveBeenCalledWith(`/api/v1/skills/${skill.id}`, {
      method: 'DELETE',
    })
  })

  it('says a skill is up to date and opens nothing', async () => {
    mocks.fetch.mockResolvedValue({ upToDate: true, pinned: false })

    await expect(useSkillActions().checkForUpdates(createSkillSummary()))
      .resolves.toBe('up-to-date')
    expect(mocks.successMessage).toHaveBeenCalled()
  })

  it('returns update when the check found a newer commit', async () => {
    mocks.fetch.mockResolvedValue({ upToDate: false, version: 8 })

    await expect(useSkillActions().checkForUpdates(createSkillSummary()))
      .resolves.toBe('update')
  })
})
