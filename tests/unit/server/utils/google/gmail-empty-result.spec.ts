import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import {
  GMAIL_FAILURE_TEXT,
  listGmailThreads,
} from '~~/server/utils/google/gmail-api'
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

const NO_RESULT_ANSWERS: Array<[string, () => Response]> = [
  ['an empty JSON object', () => new Response('{}', { status: 200 })],
  ['an empty 200 body', () => new Response('', { status: 200 })],
  ['a 200 without a body', () => new Response(null, { status: 200 })],
  [
    'only an estimate of zero',
    () => new Response('{"resultSizeEstimate":0}', { status: 200 }),
  ],
]

async function runSearch(answer: () => Response) {
  const fetchImpl = vi.fn(async () => answer())
  const built = await buildGoogleByoTools({
    db: {} as never,
    kv: {} as never,
    userId: 1,
    grantedScopes: Object.values(GOOGLE_SCOPES),
    chatGrantHashes: {},
    index: createGoogleReferenceIndex([]),
    logger: { set: vi.fn() } as never,
    fetchImpl: fetchImpl as never,
  })
  const search = built.tools.google__gmail_search as unknown as {
    execute: (
      input: { query: string },
      options: { toolCallId: string, messages: unknown[] },
    ) => Promise<Record<string, unknown>>
  }

  return await search.execute(
    { query: '"Besidka test draft"' },
    { toolCallId: 'call-1', messages: [] },
  )
}

describe('a Gmail search with no matching thread', () => {
  it.each(NO_RESULT_ANSWERS)('lists no thread for %s', async (_name, answer) => {
    const result = await listGmailThreads('anything', 5, {
      accessToken: 'token',
      fetchImpl: vi.fn(async () => answer()) as never,
    })

    expect(result).toEqual({ ok: true, value: [] })
  })

  it.each(NO_RESULT_ANSWERS)('answers "no messages" for %s', async (
    _name,
    answer,
  ) => {
    const output = await runSearch(answer)

    expect(output.count).toBe(0)
    expect(output.threads).toBe('')
    expect(output.note).toBe('No messages matched this search.')
  })

  it.each([
    ['HTML', () => new Response('<html>Bad gateway</html>', { status: 200 })],
    ['plain text', () => new Response('ok', { status: 200 })],
    ['a JSON array', () => new Response('[]', { status: 200 })],
    ['a bare null', () => new Response('null', { status: 200 })],
  ])('still fails on %s with the non-JSON phrase', async (_name, answer) => {
    await expect(runSearch(answer)).rejects.toMatchObject({
      message: `${GMAIL_FAILURE_TEXT.failed}`
        + ' (Gmail answered with something that was not JSON.)',
    })
  })

  it('still fails on an error status with an empty body', async () => {
    await expect(runSearch(() => new Response('', { status: 500 })))
      .rejects.toMatchObject({
        message: `${GMAIL_FAILURE_TEXT.failed} (Gmail answered 500.)`,
      })
  })
})
