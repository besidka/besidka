import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertGoogleUrl,
  GOOGLE_RESPONSE_MAX_BYTES,
  googleFetchJson,
} from '~~/server/utils/google/http'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('googleFetchJson', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    'http://oauth2.googleapis.com/token',
    'https://evil.example.com/token',
    'https://oauth2.googleapis.com.evil.example/token',
    'https://user:pass@oauth2.googleapis.com/token',
    'https://oauth2.googleapis.com:8443/token',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://www.googleapis.com.evil.example/drive/v3/files',
    'https://content.googleapis.com/drive/v3/files',
    'https://doc-0g.googleusercontent.com/export/abc',
    'not a url',
  ])('refuses %s before any request', async (url) => {
    const fetchImpl = vi.fn()
    const failure = await failureOf(
      googleFetchJson(url, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(500)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts only the exact allowed hosts over https', () => {
    expect(assertGoogleUrl(TOKEN_URL).hostname).toBe('oauth2.googleapis.com')
    expect(assertGoogleUrl('https://www.googleapis.com/drive/v3/files').hostname)
      .toBe('www.googleapis.com')
  })

  it('allows the Gmail API host and no lookalike of it', async () => {
    expect(assertGoogleUrl('https://gmail.googleapis.com/gmail/v1/users/me/drafts')
      .hostname).toBe('gmail.googleapis.com')

    for (const url of [
      'http://gmail.googleapis.com/gmail/v1/users/me/drafts',
      'https://gmail.googleapis.com.evil.example/gmail/v1',
      'https://mail.google.com/mail/u/0/',
      'https://gmail.googleapis.com:8443/gmail/v1',
      'https://www.googleapis.com.gmail.evil.example/gmail/v1',
    ]) {
      const fetchImpl = vi.fn()
      const failure = await failureOf(
        googleFetchJson(url, { method: 'GET' }, { fetchImpl }),
      )

      expect(failure.status).toBe(500)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('allows the Sheets API host and no lookalike of it', async () => {
    expect(assertGoogleUrl('https://sheets.googleapis.com/v4/spreadsheets/x')
      .hostname).toBe('sheets.googleapis.com')

    for (const url of [
      'http://sheets.googleapis.com/v4/spreadsheets/x',
      'https://sheets.googleapis.com.evil.example/v4/spreadsheets/x',
      'https://docs.google.com/spreadsheets/d/x',
      'https://sheets.googleapis.com:8443/v4/spreadsheets/x',
      'https://evil-sheets.googleapis.com/v4/spreadsheets/x',
      'https://user@sheets.googleapis.com/v4/spreadsheets/x',
    ]) {
      const fetchImpl = vi.fn()
      const failure = await failureOf(
        googleFetchJson(url, { method: 'GET' }, { fetchImpl }),
      )

      expect(failure.status).toBe(500)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('reads a larger answer only when the caller raises the cap', async () => {
    const big = 'x'.repeat(GOOGLE_RESPONSE_MAX_BYTES + 100)
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ text: big }))
    })
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/threads/t1'
    const refused = await failureOf(
      googleFetchJson(url, { method: 'GET' }, { fetchImpl }),
    )
    const allowed = await googleFetchJson(
      url,
      { method: 'GET' },
      { fetchImpl, maxResponseBytes: GOOGLE_RESPONSE_MAX_BYTES * 2 },
    )
    const stillCapped = await failureOf(googleFetchJson(
      url,
      { method: 'GET' },
      { fetchImpl, maxResponseBytes: 1000 },
    ))

    expect(refused.status).toBe(502)
    expect(allowed.body?.text).toBe(big)
    expect(stillCapped.status).toBe(502)
  })

  it('posts a form body with manual redirects and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'a' }))
    const result = await googleFetchJson(
      TOKEN_URL,
      { method: 'POST', form: { grant_type: 'refresh_token', token: 't' } },
      { fetchImpl },
    )
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]

    expect(url).toBe(TOKEN_URL)
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe('grant_type=refresh_token&token=t')
    expect((init.headers as Record<string, string>)['content-type'])
      .toBe('application/x-www-form-urlencoded')
    expect(result).toEqual({
      status: 200,
      ok: true,
      body: { access_token: 'a' },
      bytes: JSON.stringify({ access_token: 'a' }).length,
    })
  })

  it('never follows a redirect and cancels its body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    const fetchImpl = vi.fn(async () => {
      return new Response(body, {
        status: 302,
        headers: { location: 'https://evil.example.com/' },
      })
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'POST' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
    expect(failure.message).toBe('Google answered with a redirect')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
  })

  it('returns Google error bodies without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    })
    const result = await googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl },
    )

    expect(result).toEqual({
      status: 400,
      ok: false,
      body: { error: 'invalid_grant' },
      bytes: JSON.stringify({ error: 'invalid_grant' }).length,
    })
  })

  it('times out a request that never answers', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const failure = await failureOf(googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl, timeoutMs: 20 },
    ))

    expect(failure.status).toBe(504)
  })

  it('times out a body that never finishes', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const stream = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new Error('aborted'))
          })
        },
      })

      return new Response(stream, { status: 200 })
    })
    const failure = await failureOf(googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl, timeoutMs: 20 },
    ))

    expect(failure.status).toBe(504)
  })

  it('maps a network failure to 502', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
  })

  it('stops reading a stream once it passes the cap', async () => {
    const chunk = new Uint8Array(16 * 1024)
    let pulls = 0
    const cancel = vi.fn()
    const fetchImpl = vi.fn(async () => {
      return new Response(new ReadableStream({
        pull(controller) {
          pulls += 1
          controller.enqueue(chunk)
        },
        cancel,
      }))
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
    expect(cancel).toHaveBeenCalled()
    expect(pulls).toBeLessThan(10)
  })

  it('refuses an answer over the size cap', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('x'.repeat(GOOGLE_RESPONSE_MAX_BYTES + 1))
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
  })
})
