import { afterEach, describe, expect, it } from 'vitest'
import { ensureArtifactFramePolicy } from '../../../app/utils/artifact-frame-policy'
import {
  buildArtifactFrameSrc,
  toArtifactsFrameOrigin,
} from '#shared/utils/artifact-frame-policy'

const ARTIFACTS_ORIGIN = 'https://artifacts.example.test'
const EXPECTED_POLICY = 'frame-src \'self\' https://artifacts.example.test '
  + 'https://challenges.cloudflare.com'

function getPolicyMetas() {
  return Array.from(document.head.querySelectorAll<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy"]',
  ))
}

afterEach(() => {
  for (const meta of getPolicyMetas()) {
    meta.remove()
  }
})

describe('buildArtifactFrameSrc', () => {
  it('allows self, the artifacts origin and Turnstile', () => {
    expect(buildArtifactFrameSrc(ARTIFACTS_ORIGIN)).toBe(EXPECTED_POLICY)
  })

  it('normalises the origin', () => {
    expect(buildArtifactFrameSrc(`${ARTIFACTS_ORIGIN}/v1/index.html?x=1`))
      .toBe(EXPECTED_POLICY)
    expect(toArtifactsFrameOrigin('http://localhost:8788/'))
      .toBe('http://localhost:8788')
  })

  it('rejects anything that is not an http(s) URL', () => {
    const values = [
      '',
      'not a url',
      'javascript:alert(1)',
      'data:text/html,hi',
      null,
      undefined,
      42,
    ]

    for (const value of values) {
      expect(buildArtifactFrameSrc(value)).toBeNull()
    }
  })
})

describe('ensureArtifactFramePolicy', () => {
  it('inserts one meta policy with the frame-src directive', () => {
    expect(ensureArtifactFramePolicy(`${ARTIFACTS_ORIGIN}/`)).toBe(true)

    const metas = getPolicyMetas()

    expect(metas).toHaveLength(1)
    expect(metas[0]!.getAttribute('content')).toBe(EXPECTED_POLICY)
    expect(metas[0]!.parentElement).toBe(document.head)
  })

  it('inserts the policy only once per document', () => {
    ensureArtifactFramePolicy(ARTIFACTS_ORIGIN)
    ensureArtifactFramePolicy(ARTIFACTS_ORIGIN)
    expect(ensureArtifactFramePolicy('https://other.example.test')).toBe(true)

    const metas = getPolicyMetas()

    expect(metas).toHaveLength(1)
    expect(metas[0]!.getAttribute('content')).toBe(EXPECTED_POLICY)
  })

  it('inserts nothing for an invalid origin', () => {
    for (const value of ['', 'javascript:alert(1)', 'nope', undefined]) {
      expect(ensureArtifactFramePolicy(value)).toBe(false)
    }

    expect(getPolicyMetas()).toHaveLength(0)
  })
})
