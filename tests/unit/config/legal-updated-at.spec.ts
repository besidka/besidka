import { describe, expect, it } from 'vitest'
import {
  createGitDependencies,
  resolveLegalUpdatedAt,
  toIsoDate,
} from '~~/config/legal-updated-at'
import type { LegalUpdatedAtDependencies } from '~~/config/legal-updated-at'

const FILE_PATH = '/repo/content/legal/privacy-policy.md'
const REGISTRY_PATH = 'shared/utils/account-emails.ts'
const NOTICES_PATH = 'shared/utils/legal-notices.ts'

function createDependencies(
  commitDates: Record<string, string | null>,
  isShallow = false,
): LegalUpdatedAtDependencies {
  return {
    readCommitDate: (path) => {
      return commitDates[path] ?? null
    },
    isShallow: () => {
      return isShallow
    },
  }
}

function resolve(
  body: string,
  dependencies: LegalUpdatedAtDependencies,
  frontmatterValue: unknown = '2026-10-01',
) {
  return resolveLegalUpdatedAt(
    {
      frontmatterValue,
      filePath: FILE_PATH,
      body,
      registryPath: REGISTRY_PATH,
      noticesRegistryPath: NOTICES_PATH,
    },
    dependencies,
  )
}

describe('toIsoDate', () => {
  it('keeps the date part of strings and dates', () => {
    expect(toIsoDate('2026-10-30')).toBe('2026-10-30')
    expect(toIsoDate('2026-10-30T00:00:00.000Z')).toBe('2026-10-30')
    expect(toIsoDate(new Date('2026-10-30T00:00:00.000Z'))).toBe('2026-10-30')
  })

  it('rejects anything that is not an ISO date', () => {
    expect(toIsoDate('yesterday')).toBeNull()
    expect(toIsoDate(undefined)).toBeNull()
    expect(toIsoDate(new Date('nope'))).toBeNull()
  })
})

describe('resolveLegalUpdatedAt', () => {
  it('keeps the frontmatter date when git is older', () => {
    const dependencies = createDependencies({ [FILE_PATH]: '2026-09-01' })

    expect(resolve('body', dependencies)).toBe('2026-10-01')
  })

  it('uses the git date of the file when it is newer', () => {
    const dependencies = createDependencies({ [FILE_PATH]: '2026-10-20' })

    expect(resolve('body', dependencies)).toBe('2026-10-20')
  })

  it('ignores git in a shallow clone even when git looks newer', () => {
    const dependencies = createDependencies(
      { [FILE_PATH]: '2026-10-29', [REGISTRY_PATH]: '2026-10-29' },
      true,
    )

    expect(resolve('::account-email-list\n::', dependencies)).toBe(
      '2026-10-01',
    )
  })

  it('counts the registry date only for files using the component', () => {
    const dependencies = createDependencies({
      [FILE_PATH]: '2026-10-05',
      [REGISTRY_PATH]: '2026-10-25',
    })

    expect(resolve('plain body', dependencies)).toBe('2026-10-05')
    expect(resolve('::account-email-list\n::', dependencies)).toBe(
      '2026-10-25',
    )
  })

  it('counts the notices date only for files using the change history', () => {
    const dependencies = createDependencies({
      [FILE_PATH]: '2026-10-05',
      [REGISTRY_PATH]: '2026-10-10',
      [NOTICES_PATH]: '2026-10-31',
    })

    expect(resolve('plain body', dependencies)).toBe('2026-10-05')
    expect(resolve('::account-email-list\n::', dependencies)).toBe(
      '2026-10-10',
    )
    expect(resolve('::legal-change-history{document="x"}\n::', dependencies))
      .toBe('2026-10-31')
  })

  it('ignores the notices date in a shallow clone', () => {
    const dependencies = createDependencies(
      { [FILE_PATH]: '2026-10-29', [NOTICES_PATH]: '2026-10-29' },
      true,
    )

    expect(resolve('::legal-change-history\n::', dependencies)).toBe(
      '2026-10-01',
    )
  })

  it('keeps the newest of the three dates', () => {
    const dependencies = createDependencies({
      [FILE_PATH]: '2026-10-28',
      [REGISTRY_PATH]: '2026-10-25',
    })

    expect(resolve('::account-email-list\n::', dependencies)).toBe(
      '2026-10-28',
    )
  })

  it('falls back to the frontmatter when git returns nothing', () => {
    expect(resolve('::account-email-list\n::', createDependencies({})))
      .toBe('2026-10-01')
  })

  it('uses git when the frontmatter value is not a date', () => {
    const dependencies = createDependencies({ [FILE_PATH]: '2026-10-20' })

    expect(resolve('body', dependencies, null)).toBe('2026-10-20')
  })

  it('returns null when no source has a date', () => {
    expect(resolve('body', createDependencies({}), null)).toBeNull()
  })

  it('accepts a Date frontmatter value', () => {
    const dependencies = createDependencies({})

    expect(
      resolve('body', dependencies, new Date('2026-10-02T00:00:00.000Z')),
    ).toBe('2026-10-02')
  })
})

describe('createGitDependencies', () => {
  it('treats a missing repository as shallow and returns no date', () => {
    const dependencies = createGitDependencies('/nonexistent-besidka-path')

    expect(dependencies.isShallow()).toBe(true)
    expect(dependencies.readCommitDate('package.json')).toBeNull()
  })

  it('reads real commit dates from this checkout', () => {
    const dependencies = createGitDependencies(process.cwd())
    const date = dependencies.readCommitDate('package.json')

    if (dependencies.isShallow()) {
      expect(typeof date === 'string' || date === null).toBe(true)

      return
    }

    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
