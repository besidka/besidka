import { describe, expect, it } from 'vitest'
import {
  PROJECT_AUTO_UPDATE_VALUES,
  resolveProjectAutoUpdate,
  toProjectAutoUpdate,
} from '#shared/utils/project-memory-auto-update'

const ACCOUNT_STAMP = new Date('2026-10-01T00:00:00.000Z')
const EARLIER_PROJECT_STAMP = new Date('2026-09-01T00:00:00.000Z')
const LATER_PROJECT_STAMP = new Date('2026-10-20T00:00:00.000Z')

function settings(overrides: {
  memoryEnabled?: boolean
  memoryExtractionEnabled?: boolean
  memoryExtractionEnabledAt?: Date | null
}) {
  return {
    memoryEnabled: true,
    memoryExtractionEnabled: true,
    memoryExtractionEnabledAt: ACCOUNT_STAMP,
    ...overrides,
  }
}

describe('resolveProjectAutoUpdate', () => {
  it('lists the three choices with inherit first', () => {
    expect(PROJECT_AUTO_UPDATE_VALUES).toEqual(['inherit', 'on', 'off'])
  })

  it('maps the stored value, with NULL meaning inherit', () => {
    expect(toProjectAutoUpdate(null)).toBe('inherit')
    expect(toProjectAutoUpdate(undefined)).toBe('inherit')
    expect(toProjectAutoUpdate('on')).toBe('on')
    expect(toProjectAutoUpdate('off')).toBe('off')
  })

  it('inherits the account switch and its cut-over', () => {
    const project = { memoryAutoUpdate: null, memoryAutoUpdateEnabledAt: null }

    expect(resolveProjectAutoUpdate(project, settings({}))).toEqual({
      autoUpdate: 'inherit',
      source: 'account',
      isEffective: true,
      cutOver: ACCOUNT_STAMP,
    })
    expect(resolveProjectAutoUpdate(
      project,
      settings({ memoryExtractionEnabled: false }),
    )).toMatchObject({ isEffective: false, cutOver: null })
    expect(resolveProjectAutoUpdate(project, null)).toMatchObject({
      source: 'account',
      isEffective: false,
      cutOver: null,
    })
  })

  it('lets on and off beat the account switch', () => {
    const on = {
      memoryAutoUpdate: 'on' as const,
      memoryAutoUpdateEnabledAt: LATER_PROJECT_STAMP,
    }
    const off = {
      memoryAutoUpdate: 'off' as const,
      memoryAutoUpdateEnabledAt: null,
    }

    expect(resolveProjectAutoUpdate(
      on,
      settings({ memoryExtractionEnabled: false }),
    )).toEqual({
      autoUpdate: 'on',
      source: 'project',
      isEffective: true,
      cutOver: LATER_PROJECT_STAMP,
    })
    expect(resolveProjectAutoUpdate(off, settings({}))).toEqual({
      autoUpdate: 'off',
      source: 'project',
      isEffective: false,
      cutOver: null,
    })
  })

  it('never runs while memory is off, whatever the project says', () => {
    for (const memoryAutoUpdate of [null, 'on', 'off'] as const) {
      expect(resolveProjectAutoUpdate(
        {
          memoryAutoUpdate,
          memoryAutoUpdateEnabledAt: LATER_PROJECT_STAMP,
        },
        settings({ memoryEnabled: false }),
      )).toMatchObject({ isEffective: false, cutOver: null })
    }
  })

  it('floors an on project at the later of the two cut-overs', () => {
    expect(resolveProjectAutoUpdate(
      {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: EARLIER_PROJECT_STAMP,
      },
      settings({}),
    ).cutOver).toEqual(ACCOUNT_STAMP)
    expect(resolveProjectAutoUpdate(
      {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: LATER_PROJECT_STAMP,
      },
      settings({}),
    ).cutOver).toEqual(LATER_PROJECT_STAMP)
  })

  it('ignores a stale account stamp while the account switch is off', () => {
    expect(resolveProjectAutoUpdate(
      {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: EARLIER_PROJECT_STAMP,
      },
      settings({ memoryExtractionEnabled: false }),
    ).cutOver).toEqual(EARLIER_PROJECT_STAMP)
  })

  it('has no cut-over for an on project that was never stamped', () => {
    expect(resolveProjectAutoUpdate(
      { memoryAutoUpdate: 'on', memoryAutoUpdateEnabledAt: null },
      settings({}),
    )).toMatchObject({ isEffective: true, cutOver: null })
  })

  it('floors an inheriting project that left off at its own stamp', () => {
    expect(resolveProjectAutoUpdate(
      {
        memoryAutoUpdate: null,
        memoryAutoUpdateEnabledAt: LATER_PROJECT_STAMP,
      },
      settings({}),
    ).cutOver).toEqual(LATER_PROJECT_STAMP)
  })

  it('has no cut-over for an inheriting project without an account stamp',
    () => {
      expect(resolveProjectAutoUpdate(
        { memoryAutoUpdate: null, memoryAutoUpdateEnabledAt: null },
        settings({ memoryExtractionEnabledAt: null }),
      )).toMatchObject({ isEffective: true, cutOver: null })
    })
})
