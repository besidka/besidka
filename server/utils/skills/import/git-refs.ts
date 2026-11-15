import { GITHUB_FULL_SHA_PATTERN } from '#shared/utils/skills/github-url'

export const GIT_REFS_SERVICE_QUERY = 'service=git-upload-pack'

const PKT_LENGTH_DIGITS = 4
const PKT_FLUSH = 0
const SHA_LENGTH = 40
const HEADS_PREFIX = 'refs/heads/'
const TAGS_PREFIX = 'refs/tags/'
const PEELED_SUFFIX = '^{}'
const HEAD_NAME = 'HEAD'
const SYMREF_PREFIX = 'symref=HEAD:refs/heads/'
const EMPTY_REPOSITORY_REF = 'capabilities^{}'
const PKT_LENGTH_PATTERN = /^[0-9a-f]{4}$/

export interface GitRefAdvertisement {
  head: { sha: string, branch: string | null } | null
  branches: Map<string, string>
  tags: Map<string, string>
}

interface PktLine {
  text: string
}

function* readPktLines(bytes: Uint8Array): Generator<PktLine | null> {
  const decoder = new TextDecoder()
  let offset = 0

  while (offset < bytes.byteLength) {
    const header = decoder.decode(
      bytes.subarray(offset, offset + PKT_LENGTH_DIGITS),
    )

    if (!PKT_LENGTH_PATTERN.test(header)) {
      throw new Error('Not a pkt-line')
    }

    const length = Number.parseInt(header, 16)

    if (length === PKT_FLUSH) {
      offset += PKT_LENGTH_DIGITS
      yield null

      continue
    }

    if (length < PKT_LENGTH_DIGITS || offset + length > bytes.byteLength) {
      throw new Error('Broken pkt-line length')
    }

    yield {
      text: decoder.decode(
        bytes.subarray(offset + PKT_LENGTH_DIGITS, offset + length),
      ),
    }
    offset += length
  }
}

function readSymrefBranch(capabilities: string): string | null {
  for (const capability of capabilities.split(' ')) {
    if (capability.startsWith(SYMREF_PREFIX)) {
      return capability.slice(SYMREF_PREFIX.length) || null
    }
  }

  return null
}

/**
 * Reads the answer of `git-upload-pack` to `GET info/refs` (the git smart HTTP
 * v0 ref advertisement): a `# service=` line, a flush packet, then one
 * pkt-line per ref, `<sha> <name>`. The first ref line carries the
 * capabilities after a NUL byte, among them `symref=HEAD:refs/heads/<name>`,
 * the default branch. Only branches and tags are kept; a peeled tag
 * (`refs/tags/<name>^{}`) replaces its annotated tag object with the commit it
 * points at. Pull request refs and anything else are ignored. `null` when the
 * bytes are not an advertisement.
 */
export function parseGitRefAdvertisement(
  bytes: Uint8Array,
): GitRefAdvertisement | null {
  const advertisement: GitRefAdvertisement = {
    head: null,
    branches: new Map(),
    tags: new Map(),
  }
  let hasService = false
  let headBranch: string | null = null
  let headSha: string | null = null

  try {
    for (const packet of readPktLines(bytes)) {
      if (!packet) {
        continue
      }

      const line = packet.text.replace(/\n$/, '')

      if (line.startsWith('# service=')) {
        hasService = true

        continue
      }

      const [refPart = '', capabilities = ''] = line.split('\0')
      const separatorIndex = refPart.indexOf(' ')
      const sha = refPart.slice(0, separatorIndex)
      const name = refPart.slice(separatorIndex + 1)

      if (
        separatorIndex !== SHA_LENGTH
        || !GITHUB_FULL_SHA_PATTERN.test(sha)
        || name === EMPTY_REPOSITORY_REF
      ) {
        continue
      }

      if (capabilities) {
        headBranch = readSymrefBranch(capabilities) ?? headBranch
      }

      if (name === HEAD_NAME) {
        headSha = sha
      } else if (name.startsWith(HEADS_PREFIX)) {
        advertisement.branches.set(name.slice(HEADS_PREFIX.length), sha)
      } else if (name.startsWith(TAGS_PREFIX)) {
        const tagName = name.slice(TAGS_PREFIX.length)

        if (tagName.endsWith(PEELED_SUFFIX)) {
          advertisement.tags.set(tagName.slice(0, -PEELED_SUFFIX.length), sha)
        } else if (!advertisement.tags.has(tagName)) {
          advertisement.tags.set(tagName, sha)
        }
      }
    }
  } catch (_exception) {
    return null
  }

  if (!hasService) {
    return null
  }

  advertisement.head = headSha ? { sha: headSha, branch: headBranch } : null

  return advertisement
}
