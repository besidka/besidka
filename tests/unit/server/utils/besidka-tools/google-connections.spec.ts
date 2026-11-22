import { describe, expect, it, vi } from 'vitest'
import { isGoogleToolName } from '#shared/utils/google-tool-approvals'
import { TOOL_APPROVAL_GOOGLE_READ_SOURCE } from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

const mocks = vi.hoisted(() => ({
  listMcpGoogleConnections: vi.fn(),
  disconnectMcpGoogle: vi.fn(),
}))

vi.mock('~~/server/utils/mcp/private/google', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/mcp/private/google')
  >()

  return {
    ...actual,
    listMcpGoogleConnections: mocks.listMcpGoogleConnections,
    disconnectMcpGoogle: mocks.disconnectMcpGoogle,
  }
})

const {
  GOOGLE_SPREADING_BESIDKA_TOOLS,
  buildBesidkaChatTools,
  toBesidkaChatToolName,
  withoutGoogleSpreadingTools,
} = await import('~~/server/utils/besidka-tools/chat-adapter')
const {
  BESIDKA_TOOLS,
  listChatExposedBesidkaTools,
} = await import('~~/server/utils/besidka-tools/registry')

const STATUS_TOOL = 'list_google_connections'
const DISCONNECT_TOOL = 'disconnect_google'
const CURRENT_SLUG = '01HZXAAAAAAAAAAAAAAAAAAAAA'

function allowAllModes(): Map<string, ToolPermissionMode> {
  return new Map(listChatExposedBesidkaTools().map((besidkaTool) => {
    return [besidkaTool.name, 'allow' as ToolPermissionMode]
  }))
}

async function build(holdsGoogleData: () => boolean) {
  return await buildBesidkaChatTools({
    db: {} as never,
    userId: 7,
    currentChatSlug: CURRENT_SLUG,
    modes: allowAllModes(),
    chatGrants: {},
    maxTools: 40,
    maxBytes: 1024 * 1024,
    consumeClearedCall: () => true,
    limitCalls: async () => true,
    holdsGoogleData,
    logger: { set: vi.fn() },
  })
}

describe('Google connection tools in a chat', () => {
  it('offers the status read in the read tier with a chat description',
    () => {
      const tool = BESIDKA_TOOLS[STATUS_TOOL]

      expect('expose' in tool.chat).toBe(true)
      expect(tool.chat).toEqual({ expose: true, tier: 'read' })
      expect(tool.access).toBe('read')
      expect(tool.chatDescription?.length ?? 0).toBeGreaterThan(0)
      expect(tool.chatDescription).not.toMatch(/\bbyo\b/i)
    })

  it('keeps the disconnect out of chats and says why', () => {
    const tool = BESIDKA_TOOLS[DISCONNECT_TOOL]

    expect('excluded' in tool.chat).toBe(true)
    expect('excluded' in tool.chat && tool.chat.excluded)
      .toContain('copies the chat is using')
    expect(listChatExposedBesidkaTools().map((exposed) => {
      return exposed.name
    })).not.toContain(DISCONNECT_TOOL)
  })

  it('does not put either tool in the list withheld for Google-derived '
    + 'sends', () => {
    expect(GOOGLE_SPREADING_BESIDKA_TOOLS.has(STATUS_TOOL)).toBe(false)
    expect(GOOGLE_SPREADING_BESIDKA_TOOLS.has(DISCONNECT_TOOL)).toBe(false)

    const filtered = withoutGoogleSpreadingTools(allowAllModes())

    expect(filtered.get(STATUS_TOOL)).toBe('allow')
  })

  it('is not a Google tool: its chat name never starts with google__',
    () => {
      expect(isGoogleToolName(toBesidkaChatToolName(STATUS_TOOL)))
        .toBe(false)
      expect(isGoogleToolName(toBesidkaChatToolName(DISCONNECT_TOOL)))
        .toBe(false)
    })

  it('registers the status read as a Besidka read that sets no Google taint '
    + 'and no Google read source', async () => {
    const run = await build(() => false)
    const entry = run.approvalEntries.get(toBesidkaChatToolName(STATUS_TOOL))

    expect(entry).toBeDefined()
    expect(entry!.descriptor.family).toBe('besidka')
    expect(entry!.descriptor.access).toBe('read')
    expect(entry!.taint).toBe('besidka')
    expect(entry!.taint).not.toBe('google')
    expect(entry!.readSource).not.toBe(TOOL_APPROVAL_GOOGLE_READ_SOURCE)
    expect(run.approvalEntries.has(toBesidkaChatToolName(DISCONNECT_TOOL)))
      .toBe(false)
  })

  it('still runs in a send that holds Google data and returns the result',
    async () => {
      mocks.listMcpGoogleConnections.mockResolvedValue({
        connections: [{
          clientMode: 'besidka',
          connected: true,
          status: 'needs_reauth',
          capabilities: [],
          connectedAt: '2026-11-20T10:00:00.000Z',
        }],
      })

      const run = await build(() => true)
      const name = toBesidkaChatToolName(STATUS_TOOL)
      const tool = run.tools[name] as unknown as {
        execute: (input: unknown, options: { toolCallId: string }) => unknown
      }
      const output = await tool.execute({}, { toolCallId: 'call-1' })

      expect(String(output)).toContain('needs_reauth')
      expect(mocks.listMcpGoogleConnections).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7 }),
      )
    })

  it('does not offer the disconnect even when a send holds Google data',
    async () => {
      const run = await build(() => true)

      expect(Object.keys(run.tools)).not.toContain(
        toBesidkaChatToolName(DISCONNECT_TOOL),
      )
      expect(mocks.disconnectMcpGoogle).not.toHaveBeenCalled()
    })
})
