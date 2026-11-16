import { describe, expect, it, vi } from 'vitest'
import { addConnector } from '~~/server/utils/connectors/add'
import { assertConnectorCapacity } from '~~/server/utils/connectors/store'
import { CONNECTOR_ERRORS } from '~~/server/utils/connectors/errors'

vi.mock('~~/server/utils/connectors/store', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/connectors/store')
  >()

  return { ...original, assertConnectorCapacity: vi.fn(async () => undefined) }
})

type DbClient = Parameters<typeof addConnector>[0]

const db = {} as DbClient

async function failureOf(url: string) {
  try {
    await addConnector(db, { userId: 1, url, source: { via: 'app' } })
  } catch (exception) {
    return exception as {
      status: number
      code?: string
      message: string
      fix?: string
      link?: string
    }
  }

  throw new Error('Expected a rejection')
}

describe('addConnector own-server rule', () => {
  it.each([
    'https://besidka.com/mcp',
    'https://besidka.com/mcp/',
    'https://www.besidka.com/mcp',
    'https://pr-12-besidka.chernenko.workers.dev/mcp',
    'https://BESIDKA.com/MCP',
  ])('names the own MCP server for %s', async (url) => {
    const failure = await failureOf(url)

    expect(failure.code).toBe('CONNECTOR_OWN_SERVER')
    expect(failure.status).toBe(400)
    expect(failure.message).toBe('This is Besidka\'s own MCP server')
    expect(failure.fix).toBe(
      'To let the model use your Besidka data in chats, turn on Besidka '
      + 'tools in Labs',
    )
    expect(failure.link).toBe('/profile/labs')
  })

  it('keeps the generic message for another path on an own host', async () => {
    const failure = await failureOf('https://besidka.com/api/v1/chats')

    expect(failure.code).toBeUndefined()
    expect(failure.message).toBe('This address is not allowed')
  })

  it('keeps the generic message for a deeper MCP-like path', async () => {
    const failure = await failureOf('https://besidka.com/mcp/extra')

    expect(failure.message).toBe('This address is not allowed')
  })

  it('does not loosen other rejections', async () => {
    expect((await failureOf('http://besidka.com/mcp')).message)
      .toBe('This address is not allowed')
    expect((await failureOf('https://127.0.0.1/mcp')).message)
      .toBe('This address is not allowed')
    expect((await failureOf('https://localhost/mcp')).message)
      .toBe('This address is not allowed')
  })

  it('links the Labs page from the error text', () => {
    expect(CONNECTOR_ERRORS.CONNECTOR_OWN_SERVER.link).toBe('/profile/labs')
  })
})

describe('addConnector verifyServer', () => {
  it('refuses an own server before any verification', async () => {
    const verifyServer = vi.fn()

    await expect(addConnector(db, {
      userId: 1,
      url: 'https://besidka.com/mcp',
      source: { via: 'app' },
      verifyServer,
    })).rejects.toMatchObject({ code: 'CONNECTOR_OWN_SERVER' })
    expect(verifyServer).not.toHaveBeenCalled()
  })

  it('does not insert when the verification throws', async () => {
    const insertSpy = vi.fn()
    const spyDb = { insert: insertSpy } as unknown as DbClient
    const failure = Object.assign(new Error('not mcp'), {
      code: 'CONNECTOR_DISCOVERY_FAILED',
    })

    await expect(addConnector(spyDb, {
      userId: 1,
      url: 'https://mcp.example.com/mcp',
      source: { via: 'app' },
      verifyServer: async () => {
        throw failure
      },
    })).rejects.toBe(failure)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('hands the verification the normalized address and whether OAuth is '
    + 'allowed', async () => {
    const verifyServer = vi.fn(async () => {
      throw new Error('stop')
    })

    await expect(addConnector(db, {
      userId: 1,
      url: 'https://mcp.example.com/mcp',
      source: { via: 'app' },
      verifyServer,
    })).rejects.toThrow('stop')
    expect(verifyServer).toHaveBeenCalledWith({
      url: 'https://mcp.example.com/mcp',
      allowOAuth: true,
    })

    verifyServer.mockClear()

    await expect(addConnector(db, {
      userId: 1,
      presetId: 'github',
      source: { via: 'app' },
      verifyServer,
    })).rejects.toThrow('stop')
    expect(verifyServer).toHaveBeenCalledWith({
      url: 'https://api.githubcopilot.com/mcp/',
      allowOAuth: false,
    })
  })
})

describe('addConnector capacity check', () => {
  it('stops at the cap before any verification request', async () => {
    const verifyServer = vi.fn()
    const limit = Object.assign(new Error('limit'), {
      code: 'CONNECTOR_LIMIT_REACHED',
    })

    vi.mocked(assertConnectorCapacity).mockRejectedValueOnce(limit)

    await expect(addConnector(db, {
      userId: 1,
      url: 'https://mcp.example.com/mcp',
      source: { via: 'app' },
      verifyServer,
    })).rejects.toBe(limit)
    expect(verifyServer).not.toHaveBeenCalled()
  })
})
