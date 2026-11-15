import { describe, expect, it, vi } from 'vitest'
import {
  isAcceptableProbe,
  probePreset,
} from '../../../scripts/check-connector-presets.mjs'

const preset = { id: 'linear', url: 'https://mcp.linear.app/mcp' }

function response(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers })
}

describe('check-connector-presets', () => {
  it('accepts a 401 with a bearer challenge', () => {
    expect(isAcceptableProbe(401, new Headers({
      'www-authenticate': 'Bearer resource_metadata="https://x/prm"',
    }))).toBe(true)
  })

  it('accepts a 200 with a JSON or event-stream body and any 405', () => {
    expect(isAcceptableProbe(200, new Headers({
      'content-type': 'application/json',
    }))).toBe(true)
    expect(isAcceptableProbe(200, new Headers({
      'content-type': 'text/event-stream',
    }))).toBe(true)
    expect(isAcceptableProbe(405, new Headers())).toBe(true)
  })

  it('rejects a bare 401, an HTML 200 and other statuses', () => {
    expect(isAcceptableProbe(401, new Headers())).toBe(false)
    expect(isAcceptableProbe(200, new Headers({
      'content-type': 'text/html',
    }))).toBe(false)
    expect(isAcceptableProbe(404, new Headers({
      'content-type': 'application/json',
    }))).toBe(false)
    expect(isAcceptableProbe(301, new Headers({
      'www-authenticate': 'Bearer',
    }))).toBe(false)
  })

  it('reports a network failure instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })

    expect(await probePreset(preset, fetchImpl)).toEqual({
      id: 'linear',
      url: preset.url,
      status: 0,
      ok: false,
      error: 'getaddrinfo ENOTFOUND',
    })
  })

  it('probes with a manual redirect and an initialize request', async () => {
    const fetchImpl = vi.fn(async () => {
      return response(401, { 'www-authenticate': 'Bearer' })
    })
    const result = await probePreset(preset, fetchImpl)

    expect(result.ok).toBe(true)

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]

    expect(init.redirect).toBe('manual')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).method).toBe('initialize')
  })
})
