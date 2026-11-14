import { describe, expect, it } from 'vitest'
import { parseGitRefAdvertisement } from '~~/server/utils/skills/import/git-refs'
import {
  RECORDED_FEATURE_SHA,
  RECORDED_HEAD_SHA,
  RECORDED_LIGHT_TAG_SHA,
  RECORDED_REF_LINES,
  RECORDED_TAG_COMMIT_SHA,
  buildRecordedAdvertisement,
  pktLine,
} from '../../../../../setup/helpers/git-ref-fixture'

describe('parseGitRefAdvertisement', () => {
  it('reads HEAD, the default branch from the symref capability, branches and tags', () => {
    const result = parseGitRefAdvertisement(buildRecordedAdvertisement())!

    expect(result.head).toEqual({ sha: RECORDED_HEAD_SHA, branch: 'main' })
    expect([...result.branches]).toEqual([
      ['cj/claude-api-resync', RECORDED_FEATURE_SHA],
      ['main', RECORDED_HEAD_SHA],
    ])
  })

  it('prefers the peeled commit of an annotated tag over the tag object', () => {
    const result = parseGitRefAdvertisement(buildRecordedAdvertisement())!

    expect(result.tags.get('v1')).toBe(RECORDED_TAG_COMMIT_SHA)
    expect(result.tags.get('v1.1.0')).toBe(RECORDED_LIGHT_TAG_SHA)
    expect(result.tags.size).toBe(2)
  })

  it('ignores pull request refs', () => {
    const result = parseGitRefAdvertisement(buildRecordedAdvertisement())!

    expect([...result.branches.keys()].some(name => name.includes('pull')))
      .toBe(false)
    expect(result.tags.has('1')).toBe(false)
  })

  it('reads a flush packet between lines and a ref line without a NUL', () => {
    const noCapabilities = RECORDED_REF_LINES.slice(1)
    const result = parseGitRefAdvertisement(
      buildRecordedAdvertisement(noCapabilities),
    )!

    expect(result.head).toBeNull()
    expect(result.branches.get('main')).toBe(RECORDED_HEAD_SHA)
  })

  it('has no default branch for an empty repository', () => {
    const empty = new TextEncoder().encode([
      pktLine('# service=git-upload-pack\n'),
      '0000',
      pktLine(`${'0'.repeat(40)} capabilities^{}\u0000symref=HEAD:refs/heads/main\n`),
      '0000',
    ].join(''))
    const result = parseGitRefAdvertisement(empty)!

    expect(result.head).toBeNull()
    expect(result.branches.size).toBe(0)
  })

  it('counts the pkt-line length in bytes, so a multi-byte ref name parses', () => {
    const line = `${RECORDED_FEATURE_SHA} refs/heads/feature-ü\n`
    const result = parseGitRefAdvertisement(
      buildRecordedAdvertisement([line]),
    )!

    expect(result.branches.get('feature-ü')).toBe(RECORDED_FEATURE_SHA)
  })

  it.each([
    ['plain text', new TextEncoder().encode('<html>Not a git server</html>')],
    ['a length past the end', new TextEncoder().encode('00ffshort')],
    ['a length below the prefix', new TextEncoder().encode('0002xx')],
    ['no service line', new TextEncoder().encode(`0000${pktLine('x\n')}`)],
    ['nothing at all', new Uint8Array()],
  ])('returns null for %s', (_label, bytes) => {
    expect(parseGitRefAdvertisement(bytes)).toBeNull()
  })
})
