import { describe, expect, it } from 'vitest'
import { addConnector } from '~~/server/utils/connectors/add'
import { CONNECTOR_ERRORS } from '~~/server/utils/connectors/errors'

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
