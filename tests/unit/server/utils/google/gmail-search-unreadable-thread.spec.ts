import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { GMAIL_FAILURE_TEXT } from '~~/server/utils/google/gmail-api'
import { buildGoogleByoTools } from '~~/server/utils/google/byo-tools'
import { createGoogleReferenceIndex } from '~~/server/utils/google/chat-references'

vi.mock('~~/server/utils/google/tokens', async (importOriginal) => {
  return {
    ...await importOriginal<typeof import('~~/server/utils/google/tokens')>(),
    getGoogleAccessToken: async () => ({
      status: 'ok',
      accessToken: 'byo-token',
      expiresAt: null,
    }),
  }
})

const QUERY = 'subject:"Besidka test draft"'

function threadAnswer(threadId: string) {
  return {
    id: threadId,
    messages: [{
      id: `m-${threadId}`,
      internalDate: '1763719200000',
      snippet: 'A short preview',
      payload: {
        headers: [
          { name: 'From', value: 'Eve <eve@example.com>' },
          { name: 'Subject', value: `Subject ${threadId}` },
          { name: 'Date', value: 'Fri, 21 Nov 2025 10:00:00 +0000' },
        ],
      },
    }],
  }
}

function googleError(status: number, reason: string) {
  return new Response(
    JSON.stringify({ error: { code: status, errors: [{ reason }] } }),
    { status },
  )
}

function fakeGmail(
  threadIds: readonly string[],
  failures: Readonly<Record<string, () => Response>>,
) {
  return vi.fn(async (input: string) => {
    const url = new URL(input)

    if (url.pathname === '/gmail/v1/users/me/threads') {
      return Response.json({ threads: threadIds.map(id => ({ id })) })
    }

    const threadId = url.pathname.split('/').at(-1)!
    const failure = failures[threadId]

    return failure ? failure() : Response.json(threadAnswer(threadId))
  })
}

async function runSearch(
  fetchImpl: ReturnType<typeof fakeGmail>,
  logger: { set: ReturnType<typeof vi.fn> } = { set: vi.fn() },
) {
  const built = await buildGoogleByoTools({
    db: {} as never,
    kv: {} as never,
    userId: 1,
    grantedScopes: Object.values(GOOGLE_SCOPES),
    chatGrantHashes: {},
    index: createGoogleReferenceIndex([]),
    logger: logger as never,
    fetchImpl: fetchImpl as never,
  })
  const search = built.tools.google__gmail_search as unknown as {
    execute: (
      input: { query: string },
      options: { toolCallId: string, messages: unknown[] },
    ) => Promise<Record<string, unknown>>
  }

  return await search.execute(
    { query: QUERY },
    { toolCallId: 'call-1', messages: [] },
  )
}

describe('google__gmail_search with a thread Gmail cannot read', () => {
  it('skips a thread whose metadata answers 500 and lists the others',
    async () => {
      const output = await runSearch(fakeGmail(['t1', 't2', 't3'], {
        t2: () => googleError(500, 'backendError'),
      }))

      expect(output.count).toBe(2)
      expect(String(output.threads)).toContain('thread_id: t1')
      expect(String(output.threads)).toContain('thread_id: t3')
      expect(String(output.threads)).not.toContain('thread_id: t2')
      expect(output.note).toContain('1 matching threads could not be read')
    })

  it('skips a thread whose metadata answers 400', async () => {
    const output = await runSearch(fakeGmail(['t1', 't2'], {
      t2: () => googleError(400, 'invalidArgument'),
    }))

    expect(output.count).toBe(1)
    expect(output.note).toContain('1 matching threads could not be read')
  })

  it('skips a thread whose answer is not JSON', async () => {
    const output = await runSearch(fakeGmail(['t1', 't2'], {
      t2: () => new Response('<html>Bad gateway</html>', { status: 200 }),
    }))

    expect(output.count).toBe(1)
    expect(output.note).toContain('1 matching threads could not be read')
  })

  it('fails with the generic sentence when no thread could be read',
    async () => {
      await expect(runSearch(fakeGmail(['t1', 't2'], {
        t1: () => googleError(503, 'backendError'),
        t2: () => googleError(503, 'backendError'),
      }))).rejects.toMatchObject({
        message: GMAIL_FAILURE_TEXT.failed,
        status: 502,
      })
    })

  it('logs how many unreadable threads answered each Gmail status, as '
    + 'numbers only', async () => {
    const logger = { set: vi.fn() }

    await runSearch(fakeGmail(['t1', 't2', 't3', 't4'], {
      t2: () => googleError(500, 'backendError'),
      t3: () => new Response('<html>Bad gateway</html>', { status: 200 }),
      t4: () => googleError(500, 'backendError'),
    }), logger)

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        googleByoTools: {
          gmailSearch: {
            threads: 1,
            skipped: 0,
            unreadable: 3,
            unreadableCodes: { '500': 2, 'non-json': 1 },
          },
        },
      },
    })
  })

  it('stops asking Gmail after three unreadable threads', async () => {
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6']
    const failing = Object.fromEntries(
      ids.slice(1, 4).map(id => [id, () => googleError(500, 'backendError')]),
    )
    const fetchImpl = fakeGmail(ids, failing)
    const output = await runSearch(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1 + 4)
    expect(output.count).toBe(1)
    expect(output.note).toContain('4 matching threads could not be read')
  })

  it('still fails closed on an expired token, a scope refusal and a quota '
    + 'answer, even when another thread is fine', async () => {
    const cases: Array<[Response, string]> = [
      [googleError(401, 'authError'), GMAIL_FAILURE_TEXT.reauthorize],
      [googleError(403, 'insufficientPermissions'), GMAIL_FAILURE_TEXT.no_access],
      [googleError(429, 'rateLimitExceeded'), GMAIL_FAILURE_TEXT.rate_limited],
      [
        googleError(403, 'accessNotConfigured'),
        GMAIL_FAILURE_TEXT.api_disabled,
      ],
    ]

    for (const [response, text] of cases) {
      await expect(runSearch(fakeGmail(['t1', 't2'], {
        t2: () => response.clone(),
      }))).rejects.toMatchObject({ message: text })
    }
  })

  it('keeps skipping a thread that is gone', async () => {
    const output = await runSearch(fakeGmail(['t1', 't2'], {
      t2: () => googleError(404, 'notFound'),
    }))

    expect(output.count).toBe(1)
    expect(output).not.toHaveProperty('note')
  })
})
