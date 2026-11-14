import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSkillSourceOptions,
  estimateSkillCatalogTokens,
  filterSkills,
  formatSkillSource,
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
    })).toEqual([])
    expect(buildSkillSourceOptions(null)).toEqual([])
  })

  it('filters by source and search text', () => {
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
        command: 'run-gamma',
        slashCommand: true,
      }),
    ]

    const ids = (input: Parameters<typeof filterSkills>[1]) => {
      return filterSkills(skills, input).map(skill => skill.id)
    }

    expect(ids({ source: 'all', query: '' })).toEqual(['a', 'b', 'c'])
    expect(ids({ source: 'imported', query: '' })).toEqual(['b'])
    expect(ids({ source: 'apps', query: '' })).toEqual(['c'])
    expect(ids({ source: 'all', query: 'TRANSLATE' })).toEqual(['b'])
  })

  it('matches the search text against the command too', () => {
    const skills = [
      createSkillSummary({ id: 'a', name: 'alpha' }),
      createSkillSummary({
        id: 'c',
        name: 'gamma',
        command: 'run-gamma',
        slashCommand: true,
      }),
    ]

    expect(filterSkills(skills, { source: 'all', query: 'run-gam' })
      .map(skill => skill.id)).toEqual(['c'])
    expect(filterSkills(skills, { source: 'all', query: '  RUN-gamma ' })
      .map(skill => skill.id)).toEqual(['c'])
    expect(filterSkills(skills, { source: 'all', query: 'run-missing' }))
      .toEqual([])
  })

  it('parses unknown source filter values to all', () => {
    expect(parseSkillSourceFilter('imported')).toBe('imported')
    expect(parseSkillSourceFilter('bogus')).toBe('all')
    expect(parseSkillSourceFilter(['x'])).toBe('all')
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

  it('saves a command and its hint and returns no message', async () => {
    await expect(useSkillActions().saveCommand('id', {
      command: 'review-pr',
      argumentHint: 'A link',
    })).resolves.toBeNull()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/id', {
      method: 'PATCH',
      body: { command: 'review-pr', argumentHint: 'A link' },
    })
    expect(mocks.refreshNuxtData).toHaveBeenCalled()
    expect(mocks.errorMessage).not.toHaveBeenCalled()
  })

  it('clears a command with null', async () => {
    await useSkillActions().saveCommand('id', { command: null })

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/id', {
      method: 'PATCH',
      body: { command: null },
    })
  })

  it('returns the server reason for a refused command without a toast', async () => {
    mocks.fetch.mockRejectedValue({
      data: { message: '/review-pr is already a command' },
    })

    await expect(useSkillActions().saveCommand('id', {
      command: 'review-pr',
    })).resolves.toBe('/review-pr is already a command')
    expect(mocks.errorMessage).not.toHaveBeenCalled()
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
