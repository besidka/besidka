import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQL } from 'drizzle-orm'
import {
  GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
  GOOGLE_DATA_SHARE_OPT_IN_CODE,
  assertGoogleDataRecipient,
  buildGoogleContentPersistStatements,
  createGoogleDataRecipientError,
  createGoogleDataShareOptInError,
  decideGoogleDataGuard,
  disabledRerankModelResolver,
  fileHoldsNoGoogleContent,
  googleSafeguardGatewayErrorOverride,
  isGoogleContentFile,
  isShareVisibleForGoogleData,
  mayOfferConnectorsWithGoogleData,
  mayRunWithGoogleData,
  resolveSendGoogleContent,
  withGoogleTaintRerankStop,
  readGeminiPaidTierConfirmed,
  withoutWebSearchForGoogleData,
} from '~~/server/utils/google/data-guard'
import { encodeArtifactId } from '~~/server/utils/artifacts/store'
import { createKnowledgeTestDb } from '~~/tests/setup/helpers/knowledge-db'

const dialect = drizzle(new Database(':memory:')).dialect

function createDb(paidTierConfirmedAt: Date | null = null) {
  const findFirst = vi.fn(async () => ({ paidTierConfirmedAt }))

  return {
    db: { query: { keys: { findFirst } } } as unknown as Parameters<
      typeof decideGoogleDataGuard
    >[0]['db'],
    findFirst,
  }
}

function createLogger() {
  return { set: vi.fn() }
}

describe('readGeminiPaidTierConfirmed', () => {
  it('reads the confirmation of the user\'s Gemini key', async () => {
    const { db, findFirst } = createDb(new Date(1_000))

    expect(await readGeminiPaidTierConfirmed(db, 7)).toBe(true)
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 7, provider: 'google' },
      columns: { paidTierConfirmedAt: true },
    })
  })

  it('reads a missing confirmation, or a failed read, as not confirmed',
    async () => {
      expect(await readGeminiPaidTierConfirmed(createDb().db, 7)).toBe(false)

      const failing = {
        query: {
          keys: {
            findFirst: vi.fn(async () => {
              throw new Error('D1 down')
            }),
          },
        },
      } as unknown as Parameters<typeof readGeminiPaidTierConfirmed>[0]
      const logger = createLogger()

      expect(await readGeminiPaidTierConfirmed(failing, 7, logger))
        .toBe(false)
      expect(logger.set).toHaveBeenCalled()
    })
})

describe('decideGoogleDataGuard', () => {
  it('reads the paid-tier fact only for a direct Gemini model', async () => {
    const anthropic = createDb()

    await decideGoogleDataGuard({
      db: anthropic.db,
      userId: 1,
      recipient: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      gatewaySafeguardsSent: false,
    })

    expect(anthropic.findFirst).not.toHaveBeenCalled()

    const gemini = createDb(new Date(1_000))
    const decision = await decideGoogleDataGuard({
      db: gemini.db,
      userId: 1,
      recipient: { providerId: 'google', modelId: 'gemini-3-pro' },
      gatewaySafeguardsSent: false,
    })

    expect(gemini.findFirst).toHaveBeenCalledOnce()
    expect(decision.allowed).toBe(true)
  })

  it('never reads the Gemini key for a gateway route', async () => {
    const { db, findFirst } = createDb(new Date(1_000))
    const decision = await decideGoogleDataGuard({
      db,
      userId: 1,
      recipient: { gatewayId: 'vercel', modelId: 'google/gemini-3-pro' },
      gatewaySafeguardsSent: true,
    })

    expect(findFirst).not.toHaveBeenCalled()
    expect(decision.allowed).toBe(false)
  })
})

describe('assertGoogleDataRecipient', () => {
  it('returns at once, with no D1 read, for a chat without Google data',
    async () => {
      const { db, findFirst } = createDb()

      await expect(assertGoogleDataRecipient({
        holdsGoogleData: false,
        db,
        userId: 1,
        recipient: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        gatewaySafeguardsSent: false,
        site: 'chat-send',
      })).resolves.toBeUndefined()
      expect(findFirst).not.toHaveBeenCalled()
    })

  it('lets an allowed recipient through', async () => {
    await expect(assertGoogleDataRecipient({
      holdsGoogleData: true,
      db: createDb().db,
      userId: 1,
      recipient: { providerId: 'openai', modelId: 'gpt-5' },
      gatewaySafeguardsSent: false,
      site: 'chat-send',
    })).resolves.toBeUndefined()
  })

  it('lets a conditional recipient through once its condition is met',
    async () => {
      await expect(assertGoogleDataRecipient({
        holdsGoogleData: true,
        db: createDb(new Date(1_000)).db,
        userId: 1,
        recipient: { providerId: 'google', modelId: 'gemini-3-pro' },
        gatewaySafeguardsSent: false,
        site: 'chat-send',
      })).resolves.toBeUndefined()
    })

  it('stops a conditional recipient whose condition is unmet', async () => {
    await expect(assertGoogleDataRecipient({
      holdsGoogleData: true,
      db: createDb().db,
      userId: 1,
      recipient: { providerId: 'google', modelId: 'gemini-3-pro' },
      gatewaySafeguardsSent: false,
      site: 'chat-send',
    })).rejects.toMatchObject({
      status: 403,
      fix: expect.stringContaining('Confirm the paid tier'),
    })
  })

  it('stops a refused recipient with a 403 that names the fix',
    async () => {
      const logger = createLogger()

      await expect(assertGoogleDataRecipient({
        holdsGoogleData: true,
        db: createDb().db,
        userId: 1,
        recipient: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        gatewaySafeguardsSent: false,
        site: 'chat-send',
        logger,
      })).rejects.toMatchObject({
        status: 403,
        message: 'This model cannot be used in a chat with Google data.',
        why: 'This provider may train on your Google data.',
        fix: expect.stringContaining('Pick a model'),
        data: expect.objectContaining({
          reason: GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
        }),
      })
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          googleDataGuard: {
            site: 'chat-send',
            allowed: false,
            reason: 'refused',
            recipient: 'deepseek',
            unmet: [],
          },
        },
      })
    })

  it('stops an unknown recipient', async () => {
    await expect(assertGoogleDataRecipient({
      holdsGoogleData: true,
      db: createDb().db,
      userId: 1,
      recipient: { providerId: 'mistral', modelId: 'large' },
      gatewaySafeguardsSent: false,
      site: 'chat-send',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('stops a gateway route whose safeguard is not sent', async () => {
    await expect(assertGoogleDataRecipient({
      holdsGoogleData: true,
      db: createDb().db,
      userId: 1,
      recipient: { gatewayId: 'vercel', modelId: 'anthropic/claude-opus-5' },
      gatewaySafeguardsSent: false,
      site: 'chat-send',
    })).rejects.toMatchObject({ status: 403 })
  })
})

describe('mayRunWithGoogleData', () => {
  it('runs every call in a chat without Google data', async () => {
    expect(await mayRunWithGoogleData({
      holdsGoogleData: false,
      db: createDb().db,
      userId: 1,
      recipient: { providerId: 'moonshotai', modelId: 'kimi-k2' },
      gatewaySafeguardsSent: false,
      site: 'chat-title',
    })).toBe(true)
  })

  it('skips a refused recipient silently in a flagged chat', async () => {
    expect(await mayRunWithGoogleData({
      holdsGoogleData: true,
      db: createDb().db,
      userId: 1,
      recipient: { providerId: 'moonshotai', modelId: 'kimi-k2' },
      gatewaySafeguardsSent: false,
      site: 'chat-title',
    })).toBe(false)
  })
})

describe('withoutWebSearchForGoogleData', () => {
  it('drops native web search, Brave and Exa in a flagged chat', () => {
    expect(withoutWebSearchForGoogleData([
      'web_search',
      'web_search_brave',
      'web_search_exa',
      'image_generation',
      'code_execution',
    ], true)).toEqual(['image_generation', 'code_execution'])
  })

  it('keeps every tool in a chat without Google data', () => {
    expect(withoutWebSearchForGoogleData(['web_search_brave'], false))
      .toEqual(['web_search_brave'])
  })
})

describe('disabledRerankModelResolver', () => {
  it('never resolves a TypeSafe AI model', async () => {
    expect(await disabledRerankModelResolver()).toBeNull()
  })
})

describe('withGoogleTaintRerankStop', () => {
  it('stops reranking once a Google result arrived in the send', async () => {
    const model = { id: 'jev' }
    const resolver = vi.fn(async () => model as never)
    let tainted = false
    const guarded = withGoogleTaintRerankStop(resolver, () => tainted)

    expect(await guarded()).toBe(model)

    tainted = true

    expect(await guarded()).toBeNull()
    expect(resolver).toHaveBeenCalledOnce()
  })
})

describe('mayOfferConnectorsWithGoogleData', () => {
  it('offers connectors in a flagged chat only under tool approvals', () => {
    expect(mayOfferConnectorsWithGoogleData({
      holdsGoogleData: true,
      toolApprovalsActive: false,
    })).toBe(false)
    expect(mayOfferConnectorsWithGoogleData({
      holdsGoogleData: true,
      toolApprovalsActive: true,
    })).toBe(true)
    expect(mayOfferConnectorsWithGoogleData({
      holdsGoogleData: false,
      toolApprovalsActive: false,
    })).toBe(true)
  })
})

describe('isShareVisibleForGoogleData', () => {
  it('shows every share of a chat without Google data', () => {
    expect(isShareVisibleForGoogleData({
      googleDataAt: null,
      googleOptInAt: null,
    })).toBe(true)
  })

  it('hides a share of a flagged chat without the stored opt-in', () => {
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      googleOptInAt: null,
    })).toBe(false)
  })

  it('shows a share of a flagged chat while the opt-in is stored', () => {
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      googleOptInAt: new Date(1_000),
    })).toBe(true)
  })
})

describe('createGoogleDataRecipientError', () => {
  const decision = {
    allowed: false,
    reason: 'refused',
    recipientId: 'deepseek',
    unmetConditions: [],
    message: 'This provider may train on your Google data.',
    fix: 'Pick a model from Anthropic, OpenAI or xAI for this chat, or start '
      + 'a new chat.',
  } as unknown as Parameters<typeof createGoogleDataRecipientError>[0]

  it('tells a continuation that the paused reply cannot go on', () => {
    expect(createGoogleDataRecipientError(decision, true)).toMatchObject({
      status: 403,
      message: expect.stringContaining('This reply cannot continue'),
      fix: expect.stringContaining('Send a new message'),
    })
  })

  it('keeps the model fix on an ordinary send', () => {
    expect(createGoogleDataRecipientError(decision)).toMatchObject({
      message: 'This model cannot be used in a chat with Google data.',
      fix: decision.fix,
    })
  })
})

describe('googleSafeguardGatewayErrorOverride', () => {
  it('names the zero data retention reason for a Vercel 403', () => {
    expect(googleSafeguardGatewayErrorOverride({
      gatewayId: 'vercel',
      safeguardsSent: true,
      error: Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    })).toMatchObject({
      status: 403,
      message: expect.stringContaining('zero data retention'),
      why: expect.stringContaining('Hobby'),
    })
  })

  it('names zdr_not_attested', () => {
    expect(googleSafeguardGatewayErrorOverride({
      gatewayId: 'vercel',
      safeguardsSent: true,
      error: new Error('upstream zdr_not_attested'),
    })).toMatchObject({ why: expect.stringContaining('zdr_not_attested') })
  })

  it('leaves other gateways, other errors and unsafeguarded calls alone',
    () => {
      const forbidden = Object.assign(new Error('x'), { statusCode: 403 })

      expect(googleSafeguardGatewayErrorOverride({
        gatewayId: 'openrouter',
        safeguardsSent: true,
        error: forbidden,
      })).toEqual({})
      expect(googleSafeguardGatewayErrorOverride({
        gatewayId: 'vercel',
        safeguardsSent: false,
        error: forbidden,
      })).toEqual({})
      expect(googleSafeguardGatewayErrorOverride({
        gatewayId: 'vercel',
        safeguardsSent: true,
        error: Object.assign(new Error('x'), { statusCode: 429 }),
      })).toEqual({})
    })
})

describe('createGoogleDataShareOptInError', () => {
  it('is a 409 naming the Google content and the opt-in', () => {
    expect(createGoogleDataShareOptInError()).toMatchObject({
      status: 409,
      data: { reason: GOOGLE_DATA_SHARE_OPT_IN_CODE },
      fix: expect.stringContaining('Share the Google content'),
    })
  })
})

describe('fileHoldsNoGoogleContent', () => {
  it('drops Google copies and marked files', () => {
    const query = dialect.sqlToQuery(fileHoldsNoGoogleContent() as SQL)

    expect(query.sql).toContain('"files"."external_source" is null')
    expect(query.sql).toContain('"files"."external_source" not in (?)')
    expect(query.sql).toContain('"files"."google_derived_at" is null')
    expect(query.params).toEqual(['google'])
  })
})

describe('isGoogleContentFile', () => {
  it('counts a Google copy and a marked file, nothing else', () => {
    expect(isGoogleContentFile({ externalSource: 'google' })).toBe(true)
    expect(isGoogleContentFile({ googleDerivedAt: new Date(1_000) }))
      .toBe(true)
    expect(isGoogleContentFile({ externalSource: null, googleDerivedAt: null }))
      .toBe(false)
  })
})

describe('buildGoogleContentPersistStatements', () => {
  it('sets the flag once and pauses the share in the same batch', () => {
    const { db } = createKnowledgeTestDb()
    const [flag, pause] = buildGoogleContentPersistStatements(db, 'chat1')
    const flagSql = flag.toSQL().sql
    const pauseSql = pause.toSQL().sql

    expect(flagSql).toContain('"google_data_at" = coalesce("chats"')
    expect(pauseSql).toContain('update "chat_shares"')
    expect(pauseSql).toContain('"google_opt_in_at" = ?')
    expect(pauseSql).toContain('"indexable" = ?')
    expect(pause.toSQL().params).toEqual(
      expect.arrayContaining([null, 0]),
    )
  })
})

describe('resolveSendGoogleContent', () => {
  const userId = 7

  function seed() {
    const store = createKnowledgeTestDb()
    const now = Math.floor(Date.now() / 1000)

    vi.stubGlobal('useDb', () => store.db)

    store.insertFile({ id: 1, userId, storageKey: 'plain.pdf' })
    store.insertFile({ id: 2, userId, storageKey: 'copy.pdf' })
    store.insertFile({ id: 3, userId, storageKey: 'marked.png' })
    store.insertFile({ id: 4, userId: 99, storageKey: 'other.pdf' })
    store.sqlite.prepare(
      'update files set external_source = ? where id = ?',
    ).run('google', 2)
    store.sqlite.prepare(
      'update files set google_derived_at = ? where id in (3, 4)',
    ).run(now)

    for (const [id, derived] of [[10, null], [11, now]] as const) {
      store.sqlite.prepare(
        'insert into artifacts (id, created_at, updated_at, user_id, kind,'
        + ' title, current_version, total_bytes, created_via,'
        + ' google_derived_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, now, now, userId, 'html', 'A', 1, 10, 'chat', derived)
    }

    return store
  }

  function fileParts(...storageKeys: string[]) {
    return storageKeys.map((storageKey) => {
      return { type: 'file', mediaType: 'image/png', url: `/files/${storageKey}` }
    })
  }

  function artifactPart(id: number) {
    return {
      type: 'data-artifact-attachment',
      data: {
        artifactId: encodeArtifactId(id),
        version: 1,
        kind: 'html',
        title: 'A',
      },
    }
  }

  it('finds nothing in ordinary files and artifacts, with no query when '
    + 'there is nothing to look up', async () => {
    const { db } = seed()

    expect(await resolveSendGoogleContent({
      db,
      userId,
      chatMessages: [],
      newMessageParts: [{ type: 'text', text: 'hi' }],
    })).toEqual({ holdsGoogleContent: false, newMessage: false })
    expect(await resolveSendGoogleContent({
      db,
      userId,
      chatMessages: [{ role: 'user', parts: fileParts('plain.pdf') }],
      newMessageParts: [artifactPart(10)],
    })).toEqual({ holdsGoogleContent: false, newMessage: false })
  })

  it('counts an attached Google copy in the new message', async () => {
    expect(await resolveSendGoogleContent({
      db: seed().db,
      userId,
      chatMessages: [],
      newMessageParts: fileParts('copy.pdf'),
    })).toEqual({ holdsGoogleContent: true, newMessage: true })
  })

  it('counts a marked file in an earlier message, not as new', async () => {
    expect(await resolveSendGoogleContent({
      db: seed().db,
      userId,
      chatMessages: [{ role: 'user', parts: fileParts('marked.png') }],
      newMessageParts: [{ type: 'text', text: 'again' }],
    })).toEqual({ holdsGoogleContent: true, newMessage: false })
  })

  it('counts a marked artifact attached to the new message', async () => {
    expect(await resolveSendGoogleContent({
      db: seed().db,
      userId,
      chatMessages: [],
      newMessageParts: [artifactPart(11)],
    })).toEqual({ holdsGoogleContent: true, newMessage: true })
  })

  it('ignores another user\'s marked file', async () => {
    expect(await resolveSendGoogleContent({
      db: seed().db,
      userId,
      chatMessages: [],
      newMessageParts: fileParts('other.pdf'),
    })).toEqual({ holdsGoogleContent: false, newMessage: false })
  })
})
