import { describe, expect, it } from 'vitest'
import {
  createContentSecurityPolicy,
  createHeadersFile,
} from '~~/workers/artifacts-runtime/scripts/headers.mjs'
import { isAllowedLicense } from '~~/workers/artifacts-runtime/scripts/licenses.mjs'

describe('runtime response headers', () => {
  it('keeps the production CSP sandboxed, offline and free of esm.sh', () => {
    const policy = createContentSecurityPolicy()

    expect(policy.startsWith('sandbox allow-scripts;')).toBe(true)
    expect(policy).toContain('connect-src \'none\'')
    expect(policy).toContain('default-src \'none\'')
    expect(policy).toContain('form-action \'none\'')
    expect(policy).toContain('frame-src \'none\'')
    expect(policy).toContain('base-uri \'none\'')
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).not.toContain('esm.sh')
    expect(policy).not.toContain('allow-same-origin')
    expect(policy).toContain(
      'frame-ancestors https://besidka.com https://*.chernenko.workers.dev',
    )
    expect(policy).not.toContain('localhost')
  })

  it('allows local hosts to frame the runtime only in development', () => {
    expect(createContentSecurityPolicy({ dev: true }))
      .toContain('http://localhost:*')
  })

  it('serves vendored assets with CORS and immutable caching', () => {
    const headers = createHeadersFile()

    expect(headers).toContain([
      '/v1/assets/*',
      '  Access-Control-Allow-Origin: *',
      '  Cache-Control: public, max-age=31536000, immutable',
    ].join('\n'))
    expect(headers).toContain('/v1/index.html\n  Cache-Control: no-cache')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: no-referrer')
    expect(headers).toContain('Cross-Origin-Resource-Policy: cross-origin')
  })
})

describe('licence allowlist', () => {
  it('accepts permissive licences and compound AND expressions', () => {
    expect(isAllowedLicense('MIT')).toBe(true)
    expect(isAllowedLicense('Apache-2.0')).toBe(true)
    expect(isAllowedLicense('MIT AND ISC AND BSD-3-Clause')).toBe(true)
  })

  it('rejects copyleft, unknown and unresolved choices', () => {
    expect(isAllowedLicense('GPL-3.0-or-later')).toBe(false)
    expect(isAllowedLicense('EPL-2.0 OR GPL-3.0-or-later')).toBe(false)
    expect(isAllowedLicense('UNKNOWN')).toBe(false)
    expect(isAllowedLicense('MIT AND GPL-2.0')).toBe(false)
  })
})
