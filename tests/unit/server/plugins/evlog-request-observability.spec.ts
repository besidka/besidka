import { beforeAll, describe, expect, it, vi } from 'vitest'

let moveMcpContextToAttributes: (event: Record<string, unknown>) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('attachCloudflareMeta', vi.fn())

  const plugin = await import('~~/server/plugins/evlog-request-observability')

  moveMcpContextToAttributes = plugin.moveMcpContextToAttributes
})

function run(mcp: unknown, attributes?: Record<string, unknown>) {
  const event: Record<string, unknown> = { mcp, attributes }

  moveMcpContextToAttributes(event)

  return event
}

describe('moveMcpContextToAttributes', () => {
  it('moves the mcp object under attributes and removes the root key', () => {
    const event = run({
      transport: 'streamable-http',
      route: '/mcp',
      method: 'tools/call',
      tool: 'list_models',
      request_id: 7,
    }, { existing: true })

    expect(event.mcp).toBeUndefined()
    expect(event.attributes).toEqual({
      existing: true,
      mcp: {
        transport: 'streamable-http',
        route: '/mcp',
        method: 'tools/call',
        tool: 'list_models',
        request_id: 7,
      },
    })
  })

  it('drops the client-chosen session id', () => {
    const event = run({ route: '/mcp', session_id: 'abc-123' })

    expect(event.attributes).toEqual({ mcp: { route: '/mcp' } })
  })

  it('truncates long strings to 120 characters', () => {
    const event = run({ tool: 'x'.repeat(5000) })
    const { mcp } = event.attributes as { mcp: { tool: string } }

    expect(mcp.tool).toHaveLength(120)
  })

  it('caps arrays at 10 items and truncates their strings', () => {
    const event = run({
      tools: Array.from({ length: 100 }, () => {
        return 'y'.repeat(500)
      }),
      request_ids: Array.from({ length: 100 }, (_item, index) => {
        return index
      }),
    })
    const { mcp } = event.attributes as {
      mcp: { tools: string[], request_ids: number[] }
    }

    expect(mcp.tools).toHaveLength(10)
    expect(mcp.tools.every((tool) => {
      return tool.length === 120
    })).toBe(true)
    expect(mcp.request_ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('drops values that are not scalars or arrays of scalars', () => {
    const event = run({
      nested: { deep: 'value' },
      nothing: null,
      mixed: ['a', { x: 1 }, 2],
    })

    expect(event.attributes).toEqual({ mcp: { mixed: ['a', 2] } })
  })

  it('does nothing when there is no mcp context', () => {
    const event = run(undefined)

    expect(event.attributes).toBeUndefined()
    expect('mcp' in event && event.mcp).toBeFalsy()
  })
})
