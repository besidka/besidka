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
  listSelectableChatConnectorIds,
  persistChatConnectorSelection,
  planSendConnectors,
  resolveConnectorSelection,
  toConnectorSummary,
} = await import('~~/server/utils/connectors/chat-selection')
const {
  createConnector,
  listConnectorChatSettings,
  listConnectors,
  resetConnectorChatSettings,
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

    it('lists only stored connectors that are selectable now', async () => {
      const ready = await addConnector('ready')
      const off = await addConnector('off')
      const auth = await addConnector('auth')

      await persistChatConnectorSelection(testDb.db, {
        userId,
        chatPublicId: chatId,
        selectedIds: [ready, off, auth],
      })
      await updateConnector(testDb.db, userId, off, { enabled: false })
      await updateConnector(testDb.db, userId, auth, { status: 'needs-auth' })

      expect(await listSelectableChatConnectorIds(testDb.db, userId, chatId))
        .toEqual({ connectorIds: [ready], offConnectorIds: [] })
      expect((await listChatConnectorIds(testDb.db, userId, chatId)).sort())
        .toEqual([ready, off, auth].sort())
    })

    it('lists the off ids of connectors that exist', async () => {
      const known = await addConnector('known')

      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chatId,
        connectorId: known,
        enabled: false,
        alwaysAllowTools: {},
      })

      expect(await listSelectableChatConnectorIds(testDb.db, userId, chatId))
        .toEqual({ connectorIds: [], offConnectorIds: [known] })
    })

    it('writes off rows for offIds and deletes an Auto off row once cleared',
      async () => {
        const manual = await addConnector('manual', {
          status: 'ready',
          enabled: true,
          toolMode: 'manual',
        })
        const auto = await addConnector('auto', {
          status: 'ready',
          enabled: true,
          toolMode: 'auto',
        })
        const alwaysOn = await addConnector('always', {
          status: 'ready',
          enabled: true,
          toolMode: 'always-on',
        })
        const connectors = await listConnectors(testDb.db, userId)

        await persistChatConnectorSelection(testDb.db, {
          userId,
          chatPublicId: chatId,
          selectedIds: [],
          offIds: [auto, alwaysOn, manual],
          connectors,
        })

        expect(await listChatConnectorIds(testDb.db, userId, chatId))
          .toEqual([])
        expect((await listSelectableChatConnectorIds(
          testDb.db,
          userId,
          chatId,
        )).offConnectorIds.sort()).toEqual([auto, alwaysOn, manual].sort())

        await persistChatConnectorSelection(testDb.db, {
          userId,
          chatPublicId: chatId,
          selectedIds: [],
          offIds: [manual],
          connectors,
        })

        expect(await listChatConnectorIds(testDb.db, userId, chatId))
          .toEqual([])
        expect((await listSelectableChatConnectorIds(
          testDb.db,
          userId,
          chatId,
        )).offConnectorIds).toEqual([manual])
        expect((await listConnectorChatSettings(testDb.db, userId, chatId))
          .map(row => row.connectorId)).toEqual([manual])
      })

    it('keeps the grants of a cleared Auto off row and never writes an on '
      + 'row for an Auto connector', async () => {
      const auto = await addConnector('auto', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const granted = await addConnector('granted', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const connectors = await listConnectors(testDb.db, userId)

      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chatId,
        connectorId: granted,
        enabled: false,
        alwaysAllowTools: { mcp__granted__read: 'hash' },
      })
      await persistChatConnectorSelection(testDb.db, {
        userId,
        chatPublicId: chatId,
        selectedIds: [auto],
        offIds: [],
        connectors,
      })

      const rows = await listConnectorChatSettings(testDb.db, userId, chatId)

      expect(rows).toEqual([expect.objectContaining({
        connectorId: granted,
        enabled: true,
        alwaysAllowTools: { mcp__granted__read: 'hash' },
      })])
    })

    it('resets every chat row of a connector after a mode change, keeping '
      + 'grants', async () => {
      const connectorId = await addConnector('linear', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const otherChatId = (await seedChat(testDb.db, userId)).id

      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chatId,
        connectorId,
        enabled: true,
        alwaysAllowTools: {},
      })
      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: otherChatId,
        connectorId,
        enabled: true,
        alwaysAllowTools: { mcp__linear__read: 'hash' },
      })
      await resetConnectorChatSettings(testDb.db, {
        userId,
        connectorId,
        enabled: false,
      })

      expect(await listConnectorChatSettings(testDb.db, userId, chatId))
        .toEqual([])
      expect(await listConnectorChatSettings(testDb.db, userId, otherChatId))
        .toEqual([expect.objectContaining({
          enabled: false,
          alwaysAllowTools: { mcp__linear__read: 'hash' },
        })])
    })

    it('keeps an Auto and Always on row on when offIds is absent, and still '
      + 'turns a deselected Manual off', async () => {
      const manual = await addConnector('manual', {
        status: 'ready',
        enabled: true,
        toolMode: 'manual',
      })
      const auto = await addConnector('auto', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const alwaysOn = await addConnector('always', {
        status: 'ready',
        enabled: true,
        toolMode: 'always-on',
      })
      const connectors = await listConnectors(testDb.db, userId)

      for (const connectorId of [manual, auto, alwaysOn]) {
        await upsertConnectorChatSettings(testDb.db, {
          userId,
          chatPublicId: chatId,
          connectorId,
          enabled: true,
          alwaysAllowTools: {},
        })
      }

      await persistChatConnectorSelection(testDb.db, {
        userId,
        chatPublicId: chatId,
        selectedIds: [],
        connectors,
      })

      expect((await listChatConnectorIds(testDb.db, userId, chatId)).sort())
        .toEqual([auto, alwaysOn].sort())
    })

    it('does not touch an Auto off row when offIds is absent', async () => {
      const auto = await addConnector('auto', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const connectors = await listConnectors(testDb.db, userId)

      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chatId,
        connectorId: auto,
        enabled: false,
        alwaysAllowTools: {},
      })
      await persistChatConnectorSelection(testDb.db, {
        userId,
        chatPublicId: chatId,
        selectedIds: [],
        connectors,
      })

      expect((await listSelectableChatConnectorIds(
        testDb.db,
        userId,
        chatId,
      )).offConnectorIds).toEqual([auto])
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

  describe('planSendConnectors', () => {
    async function plan(input: {
      onIds?: string[]
      offIds?: string[]
    } = {}) {
      return planSendConnectors({
        connectors: await listConnectors(testDb.db, userId),
        onIds: input.onIds ?? [],
        offIds: input.offIds ?? [],
      })
    }

    function slugsOf(connectors: { slug: string }[]) {
      return connectors.map(connector => connector.slug).sort()
    }

    it('uses a Manual connector only when the chat has it on', async () => {
      const manual = await addConnector('manual', {
        status: 'ready',
        enabled: true,
        toolMode: 'manual',
      })

      expect((await plan()).live.selected).toEqual([])
      expect((await plan()).catalog).toEqual([])
      expect(slugsOf((await plan({ onIds: [manual] })).live.selected))
        .toEqual(['manual'])
    })

    it('uses an Always on connector in every chat', async () => {
      await addConnector('always', {
        status: 'ready',
        enabled: true,
        toolMode: 'always-on',
      })

      const result = await plan()

      expect(slugsOf(result.live.selected)).toEqual(['always'])
      expect(result.catalog).toEqual([])
    })

    it('always puts an Auto connector in the catalog, even with an on row',
      async () => {
        const auto = await addConnector('auto', {
          status: 'ready',
          enabled: true,
          toolMode: 'auto',
        })

        for (const onIds of [[], [auto]]) {
          const result = await plan({ onIds })

          expect(slugsOf(result.catalog)).toEqual(['auto'])
          expect(result.live.selected).toEqual([])
          expect(result.requestedSkipped).toEqual([])
        }
      })

    it('treats an unset mode as Auto', async () => {
      await addConnector('unset', { status: 'ready', enabled: true })

      expect(slugsOf((await plan()).catalog)).toEqual(['unset'])
    })

    it('lets an off row win for every mode', async () => {
      const manual = await addConnector('manual', {
        status: 'ready',
        enabled: true,
        toolMode: 'manual',
      })
      const auto = await addConnector('auto', {
        status: 'ready',
        enabled: true,
        toolMode: 'auto',
      })
      const alwaysOn = await addConnector('always', {
        status: 'ready',
        enabled: true,
        toolMode: 'always-on',
      })
      const result = await plan({
        onIds: [manual, auto, alwaysOn],
        offIds: [manual, auto, alwaysOn],
      })

      expect(result.live.selected).toEqual([])
      expect(result.catalog).toEqual([])
      expect(result.requestedSkipped).toEqual([])
    })

    it('caps live connectors at five, chat-on first, then Always on',
      async () => {
        const onIds: string[] = []

        for (const slug of ['m1', 'm2', 'm3']) {
          onIds.push(await addConnector(slug, {
            status: 'ready',
            enabled: true,
            toolMode: 'manual',
          }))
        }

        for (const slug of ['a1', 'a2', 'a3']) {
          await addConnector(slug, {
            status: 'ready',
            enabled: true,
            toolMode: 'always-on',
          })
        }

        const result = await plan({ onIds })

        const selectedSlugs = result.live.selected.map((connector) => {
          return connector.slug
        })

        expect(selectedSlugs.slice(0, 3)).toEqual(['m1', 'm2', 'm3'])
        expect(selectedSlugs).toHaveLength(5)
        expect(result.live.overCap).toHaveLength(1)
        expect(result.live.overCap[0]!.slug).toMatch(/^a\d$/)
      })

    it('reports requested skips only for connectors the chat has on',
      async () => {
        const offManual = await addConnector('offmanual', {
          status: 'ready',
          enabled: false,
          toolMode: 'manual',
        })

        await addConnector('offalways', {
          status: 'ready',
          enabled: false,
          toolMode: 'always-on',
        })
        await addConnector('authalways', {
          status: 'needs-auth',
          enabled: true,
          toolMode: 'always-on',
        })

        const result = await plan({ onIds: [offManual] })

        expect(slugsOf(result.requestedSkipped)).toEqual(['offmanual'])
        expect(result.live.selected).toEqual([])
      })

    it('keeps unknown ids out of the plan and an unusable Auto connector '
      + 'out of the catalog', async () => {
      await addConnector('offauto', {
        status: 'ready',
        enabled: false,
        toolMode: 'auto',
      })
      await addConnector('authauto', {
        status: 'needs-auth',
        enabled: true,
        toolMode: 'auto',
      })

      const result = await plan({ onIds: ['nope'] })

      expect(result.catalog).toEqual([])
      expect(result.live.unknownIds).toEqual(['nope'])
      expect(result.requestedSkipped).toEqual([])
    })
  })
})
