const SEMVER_TAG_PATTERN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/
const SHORT_SHA_LENGTH = 7

export interface GithubReleaseTag {
  tag: string
  sha: string
}

interface SemverParts {
  major: number
  minor: number
  patch: number
}

function readSemverParts(tag: string): SemverParts | null {
  const match = SEMVER_TAG_PATTERN.exec(tag)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

/**
 * A release tag is `MAJOR.MINOR.PATCH` with an optional leading `v` and
 * nothing else: `2.1.2` and `v2.1.2` count, `2.1.2-rc.1`, `2.1` and `latest`
 * do not, so a pre-release is never offered as the latest release.
 */
export function isSemverTag(tag: string): boolean {
  return SEMVER_TAG_PATTERN.test(tag)
}

/**
 * Numeric, not alphabetical: `2.10.0` is above `2.9.0`. Equal versions (a
 * `v2.1.2` next to a `2.1.2`) fall back to the name so the order is stable.
 */
export function compareSemverTags(left: string, right: string): number {
  const leftParts = readSemverParts(left)
  const rightParts = readSemverParts(right)

  if (!leftParts || !rightParts) {
    return left.localeCompare(right)
  }

  return leftParts.major - rightParts.major
    || leftParts.minor - rightParts.minor
    || leftParts.patch - rightParts.patch
    || left.localeCompare(right)
}

/**
 * The release tags among `tags` (a name to commit map), highest version
 * first. Anything that is not a plain `MAJOR.MINOR.PATCH` is dropped.
 */
export function sortReleaseTagsDescending(
  tags: Iterable<[string, string]>,
): GithubReleaseTag[] {
  return [...tags]
    .filter(([tag]) => {
      return isSemverTag(tag)
    })
    .map(([tag, sha]) => {
      return { tag, sha }
    })
    .sort((left, right) => {
      return compareSemverTags(right.tag, left.tag)
    })
}

/**
 * The highest release tag that points at `sha`, or null. A commit that is
 * the tip of a release shows that release instead of its hash.
 */
export function findReleaseTagForSha(
  tags: Iterable<[string, string]>,
  sha: string,
): string | null {
  const match = sortReleaseTagsDescending(tags).find((candidate) => {
    return candidate.sha === sha
  })

  return match?.tag ?? null
}

/**
 * The version a GitHub source is shown at: the release tag when the skill is
 * pinned to one (the tag name is stored in the source ref), else the first
 * seven characters of the commit.
 */
export function formatGithubSourceVersion(input: {
  sourceRef: string | null
  sourceVersion: string | null
}): string | null {
  if (input.sourceRef && isSemverTag(input.sourceRef)) {
    return input.sourceRef
  }

  return input.sourceVersion
    ? input.sourceVersion.slice(0, SHORT_SHA_LENGTH)
    : null
}
