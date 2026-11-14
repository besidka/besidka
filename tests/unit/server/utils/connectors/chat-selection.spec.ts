import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { fakeDecrypt, fakeEncrypt } from '../../../../setup/helpers/connectors-oauth'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  isConnectorSelectable,
  listChatConnectorIds,
  persistChatConnectorSelection,
  resolveConnectorSelection,
  toConnectorSummary,
} = await import('~~/server/utils/connectors/chat-selection')
const {
  createConnector,
  listConnectorChatSettings,
  listConnectors,
  updateConnector,
  upsertConnectorChatSettings,
} = await import('~~/server/utils/connectors/store')

describe('connector chat selection', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatId: string

  async function addConnector(
    slug: string,
    patch: Parameters<typeof updateConnector>[3] = {
      status: 'ready',
      enabled: true,
    },
  ) {
    const connector = await createConnector(testDb.db, {
      userId,
      title: slug,
      url: `https://mcp.${slug}.example.com/mcp?key=secret`,
      slugBase: slug,
      createdVia: 'app',
    })

    await updateConnector(testDb.db, userId, connector.id, patch)

    return connector.id
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
    userId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, userId)).id
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('accepts only enabled connectors that are ready or drifted', async () => {
    await addConnector('ready')
    await addConnector('drifted', { status: 'drifted', enabled: true })
    await addConnector('off', { status: 'ready', enabled: false })
    await addConnector('auth', { status: 'needs-auth', enabled: true })
    await addConnector('broken', { status: 'error', enabled: true })

    const connectors = await listConnectors(testDb.db, userId)

    expect(connectors.filter(isConnectorSelectable).map(c => c.slug).sort())
      .toEqual(['drifted', 'ready'])
  })

  it('splits a request into selected, skipped, over the cap and unknown, '
    + 'keeping the request order', async () => {
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f']
    const ids: string[] = []

    for (const slug of slugs) {
      ids.push(await addConnector(slug))
    }

    const offId = await addConnector('off', { status: 'ready', enabled: false })
    const connectors = await listConnectors(testDb.db, userId)
    const selection = resolveConnectorSelection(connectors, [
      ids[5]!,
      offId,
      'nope',
      ids[0]!,
      ids[0]!,
      ids[1]!,
      ids[2]!,
      ids[3]!,
      ids[4]!,
    ])

    expect(selection.selected.map(c => c.slug)).toEqual(['f', 'a', 'b', 'c', 'd'])
    expect(selection.overCap.map(c => c.slug)).toEqual(['e'])
    expect(selection.skipped.map(c => c.slug)).toEqual(['off'])
    expect(selection.unknownIds).toEqual(['nope'])
  })

  it('never selects another user\'s connector', async () => {
    const otherUserId = await seedUser(testDb.db, null)
    const foreign = await createConnector(testDb.db, {
      userId: otherUserId,
      title: 'foreign',
      url: 'https://mcp.foreign.example.com/mcp',
      slugBase: 'foreign',
      createdVia: 'app',
    })
    const mine = await listConnectors(testDb.db, userId)

    expect(resolveConnectorSelection(mine, [foreign.id]).unknownIds)
      .toEqual([foreign.id])
  })

  it('summarizes a connector without its URL path, secrets or error text',
    async () => {
      const id = await addConnector('linear', {
        status: 'ready',
        enabled: true,
        lastError: { code: 'X', message: 'upstream text' },
      })
      const summary = toConnectorSummary(
        (await listConnectors(testDb.db, userId)).find(c => c.id === id)!,
      )

      expect(summary).toMatchObject({
        id,
        slug: 'linear',
        host: 'mcp.linear.example.com',
        status: 'ready',
        enabled: true,
      })
      expect(JSON.stringify(summary)).not.toContain('secret')
      expect(JSON.stringify(summary)).not.toContain('upstream text')
    })

  describe('persistChatConnectorSelection', () => {
    it('turns the selected on, the rest off and keeps always-allow maps',
      async () => {
        const first = await addConnector('first')
        const second = await addConnector('second')

        await upsertConnectorChatSettings(testDb.db, {
          userId,
          chatPublicId: chatId,
          connectorId: first,
          enabled: true,
          alwaysAllowTools: { list: 'hash-1' },
        })
        await persistChatConnectorSelection(testDb.db, {
          userId,
          chatPublicId: chatId,
          selectedIds: [second],
        })

        expect(await listChatConnectorIds(testDb.db, userId, chatId))
          .toEqual([second])

        const rows = await listConnectorChatSettings(testDb.db, userId, chatId)

        expect(rows.find(row => row.connectorId === first)).toMatchObject({
          enabled: false,
          alwaysAllowTools: { list: 'hash-1' },
        })

        await persistChatConnectorSelection(testDb.db, {
          userId,
          chatPublicId: chatId,
          selectedIds: [first, second],
        })

        expect((await listChatConnectorIds(testDb.db, userId, chatId)).sort())
          .toEqual([first, second].sort())
        expect((await listConnectorChatSettings(testDb.db, userId, chatId))
          .find(row => row.connectorId === first)?.alwaysAllowTools)
          .toEqual({ list: 'hash-1' })
      })

    it('stores nothing for an empty selection of a fresh chat', async () => {
      await persistChatConnectorSelection(testDb.db, {
        userId,
        chatPublicId: chatId,
        selectedIds: [],
      })

      expect(await listConnectorChatSettings(testDb.db, userId, chatId))
        .toEqual([])
    })
  })
})
