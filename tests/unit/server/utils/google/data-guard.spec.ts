import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQL } from 'drizzle-orm'
import {
  GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
  GOOGLE_DATA_SHARE_OPT_IN_CODE,
  assertGoogleDataRecipient,
  createGoogleDataShareOptInError,
  decideGoogleDataGuard,
  disabledRerankModelResolver,
  fileIsNotGoogleCopy,
  isShareVisibleForGoogleData,
  mayOfferConnectorsWithGoogleData,
  mayRunWithGoogleData,
  withGoogleTaintRerankStop,
  readArtifactHoldsGoogleData,
  readGeminiPaidTierConfirmed,
  withoutWebSearchForGoogleData,
} from '~~/server/utils/google/data-guard'

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
      shareUpdatedAt: new Date(1_000),
    })).toBe(true)
  })

  it('hides a share made before the flag, or in the same second', () => {
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      shareUpdatedAt: new Date(1_000),
    })).toBe(false)
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      shareUpdatedAt: new Date(2_000),
    })).toBe(false)
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      shareUpdatedAt: null,
    })).toBe(false)
  })

  it('shows a share made after the flag, with the opt-in', () => {
    expect(isShareVisibleForGoogleData({
      googleDataAt: new Date(2_000),
      shareUpdatedAt: new Date(3_000),
    })).toBe(true)
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

describe('fileIsNotGoogleCopy', () => {
  it('keeps uploads and drops every Google external source', () => {
    const query = dialect.sqlToQuery(fileIsNotGoogleCopy() as SQL)

    expect(query.sql).toContain('"files"."external_source" is null')
    expect(query.sql).toContain('"files"."external_source" not in (?)')
    expect(query.params).toEqual(['google'])
  })
})

describe('readArtifactHoldsGoogleData', () => {
  function createSelectDb(row: unknown) {
    const get = vi.fn(async () => row)
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      get,
    }

    return {
      db: { select: vi.fn(() => chain) } as unknown as Parameters<
        typeof readArtifactHoldsGoogleData
      >[0],
      chain,
    }
  }

  it('is true when the artifact\'s origin chat holds Google data',
    async () => {
      const { db, chain } = createSelectDb({ id: 3 })

      expect(await readArtifactHoldsGoogleData(db, 3)).toBe(true)
      expect(chain.innerJoin).toHaveBeenCalled()
    })

  it('is false for an artifact of an ordinary chat', async () => {
    expect(await readArtifactHoldsGoogleData(createSelectDb(undefined).db, 3))
      .toBe(false)
  })
})
