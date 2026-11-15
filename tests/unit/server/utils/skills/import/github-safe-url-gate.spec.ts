import { describe, expect, it } from 'vitest'
import { assertAllowedGithubUrl } from '~~/server/utils/skills/import/github'

const REFS_URL
  = 'https://github.com/besidka/besidka.git/info/refs?service=git-upload-pack'

describe('assertAllowedGithubUrl and the safe outbound URL gate', () => {
  it('still accepts the two allowed shapes', () => {
    expect(assertAllowedGithubUrl(REFS_URL).hostname).toBe('github.com')
    expect(
      assertAllowedGithubUrl(
        'https://codeload.github.com/besidka/besidka/zip/abc123',
      ).hostname,
    ).toBe('codeload.github.com')
  })

  it.each([
    REFS_URL.replace('github.com/', 'github.com/\nbesidka/'),
    `${REFS_URL}\u0000`,
    REFS_URL.replace('besidka.git', 'besidka\t.git'),
    `https://codeload.github.com/o/r/zip/${'a'.repeat(3000)}`,
  ])('rejects an address with control characters or a huge length: %#', (input) => {
    expect(() => assertAllowedGithubUrl(input)).toThrow(
      'This address is not allowed',
    )
  })

  it.each([
    'http://github.com/o/r.git/info/refs?service=git-upload-pack',
    'https://api.github.com/repos/o/r',
    'https://github.com.evil.example/o/r.git/info/refs?service=git-upload-pack',
    'https://127.0.0.1/o/r.git/info/refs?service=git-upload-pack',
    'https://github.com:8443/o/r.git/info/refs?service=git-upload-pack',
  ])('keeps rejecting %s', (input) => {
    expect(() => assertAllowedGithubUrl(input)).toThrow(
      'This address is not allowed',
    )
  })
})
