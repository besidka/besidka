import { isGithubFullSha, isReservedGithubRef } from '#shared/utils/skills/github-url'
import {
  compareSemverTags,
  isSemverTag,
  sortReleaseTagsDescending,
} from '#shared/utils/skills/release'
import {
  fetchGithubRefs,
  resolveGithubRef,
} from '~~/server/utils/skills/import/github'
import type {
  GithubClient,
  GithubRepository,
} from '~~/server/utils/skills/import/github'

export type GithubUpstreamTarget
  = | { kind: 'pinned' }
    | { kind: 'missing' }
    | { kind: 'found', ref: string, sha: string, tag: string | null }

/**
 * Where a GitHub skill's upstream is now, read from the ref list alone (no
 * archive, no REST call). A skill pinned to a commit has nothing to follow.
 * A skill pinned to a release tag follows the highest release tag, which is
 * its own tag while nothing newer exists. Any other ref is a branch (or
 * `HEAD`) and follows its head. A deleted branch, or a tag that is gone with
 * no release to replace it, is `missing`.
 */
export async function resolveGithubUpstream(
  client: GithubClient,
  repository: GithubRepository,
  sourceRef: string,
): Promise<GithubUpstreamTarget> {
  if (isGithubFullSha(sourceRef)) {
    return { kind: 'pinned' }
  }

  if (isReservedGithubRef(sourceRef)) {
    return { kind: 'missing' }
  }

  if (!isSemverTag(sourceRef)) {
    const lookup = await resolveGithubRef(client, {
      ...repository,
      ref: sourceRef,
    })

    return lookup.found
      ? { kind: 'found', ref: sourceRef, sha: lookup.sha, tag: null }
      : { kind: 'missing' }
  }

  const advertisement = await fetchGithubRefs(client, repository)
  const latest = sortReleaseTagsDescending(advertisement.tags)[0]
  const ownSha = advertisement.tags.get(sourceRef)

  if (latest && compareSemverTags(latest.tag, sourceRef) >= 0) {
    return { kind: 'found', ref: latest.tag, sha: latest.sha, tag: latest.tag }
  }

  return ownSha
    ? { kind: 'found', ref: sourceRef, sha: ownSha, tag: sourceRef }
    : { kind: 'missing' }
}
