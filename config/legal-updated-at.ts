import { execFileSync } from 'node:child_process'

export const ACCOUNT_EMAIL_REGISTRY_PATH = 'shared/utils/account-emails.ts'

export const ACCOUNT_EMAIL_LIST_COMPONENT = 'account-email-list'

export const LEGAL_NOTICES_REGISTRY_PATH = 'shared/utils/legal-notices.ts'

export const LEGAL_CHANGE_HISTORY_COMPONENT = 'legal-change-history'

const ISO_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})/

export interface LegalUpdatedAtDependencies {
  readCommitDate: (path: string) => string | null
  isShallow: () => boolean
}

export interface LegalUpdatedAtInput {
  frontmatterValue: unknown
  filePath: string
  body: string
  registryPath: string
  noticesRegistryPath: string
}

export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10)
  }

  if (typeof value !== 'string') {
    return null
  }

  return value.trim().match(ISO_DATE_PATTERN)?.[1] ?? null
}

/**
 * The frontmatter date is the floor. Git can only raise it, and only when the
 * checkout has full history: in a shallow clone every file reports the date
 * of HEAD, so git is ignored there.
 */
export function resolveLegalUpdatedAt(
  input: LegalUpdatedAtInput,
  dependencies: LegalUpdatedAtDependencies,
): string | null {
  const frontmatterDate = toIsoDate(input.frontmatterValue)

  if (dependencies.isShallow()) {
    return frontmatterDate
  }

  const candidates = [
    frontmatterDate,
    toIsoDate(dependencies.readCommitDate(input.filePath)),
  ]

  if (input.body.includes(ACCOUNT_EMAIL_LIST_COMPONENT)) {
    candidates.push(
      toIsoDate(dependencies.readCommitDate(input.registryPath)),
    )
  }

  if (input.body.includes(LEGAL_CHANGE_HISTORY_COMPONENT)) {
    candidates.push(
      toIsoDate(dependencies.readCommitDate(input.noticesRegistryPath)),
    )
  }

  const dates = candidates.filter((date): date is string => {
    return date !== null
  })

  return dates.sort().at(-1) ?? null
}

export function createGitDependencies(
  repositoryRoot: string,
): LegalUpdatedAtDependencies {
  let shallow: boolean | undefined

  function runGit(args: string[]): string | null {
    try {
      return execFileSync('git', args, {
        cwd: repositoryRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
      }).trim()
    } catch {
      return null
    }
  }

  return {
    readCommitDate(path) {
      return runGit(['log', '-1', '--format=%cs', '--', path])
    },
    isShallow() {
      shallow ??= runGit(['rev-parse', '--is-shallow-repository']) !== 'false'

      return shallow
    },
  }
}
