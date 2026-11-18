import { describe, expect, it } from 'vitest'
import {
  addConnector,
  resolveConnectorTarget,
} from '~~/server/utils/connectors/add'
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

describe('resolveConnectorTarget', () => {
  it('makes no request and keeps the typed address and the preset rules',
    () => {
      expect(resolveConnectorTarget({
        url: 'https://mcp.example.com/mcp',
        title: '  Example  ',
        source: { via: 'app' },
      })).toEqual({
        url: 'https://mcp.example.com/mcp',
        host: 'mcp.example.com',
        title: 'Example',
        presetId: null,
        slugBase: 'example',
        allowOAuth: true,
        createdVia: 'app',
        createdByClientId: null,
      })
      expect(resolveConnectorTarget({
        presetId: 'github',
        source: { via: 'app' },
      })).toMatchObject({
        url: 'https://api.githubcopilot.com/mcp/',
        presetId: 'github',
        title: 'GitHub',
        allowOAuth: false,
        createdVia: 'preset',
      })
    })

  it('records a directory entry as registry and an MCP add with its client',
    () => {
      expect(resolveConnectorTarget({
        source: {
          via: 'registry',
          entry: {
            remoteUrl: 'https://mcp.tracker.example.com/mcp',
            title: 'Tracker',
          },
        },
      })).toMatchObject({
        title: 'Tracker',
        createdVia: 'registry',
        createdByClientId: null,
      })
      expect(resolveConnectorTarget({
        presetId: 'github',
        source: { via: 'mcp', clientId: 'client-1' },
      })).toMatchObject({
        createdVia: 'mcp',
        createdByClientId: 'client-1',
      })
    })

  it('derives the slug base from the directory title, the typed title, '
    + 'then the registrable domain', () => {
    type TargetInput = Parameters<typeof resolveConnectorTarget>[0]
    const slugBaseOf = (input: TargetInput) => {
      return resolveConnectorTarget(input).slugBase
    }

    expect(slugBaseOf({
      url: 'https://mcp.tracker.example.com/mcp',
      source: { via: 'app' },
    })).toBe('example')
    expect(slugBaseOf({
      url: 'https://mcp.tracker.example.com/mcp',
      title: 'Tracker Search',
      source: { via: 'app' },
    })).toBe('tracker-search')
    expect(slugBaseOf({
      source: {
        via: 'registry',
        entry: {
          remoteUrl: 'https://mcp.tracker.example.com/mcp',
          title: 'Tracker',
        },
      },
    })).toBe('tracker')
    expect(slugBaseOf({
      source: {
        via: 'registry',
        entry: {
          remoteUrl: 'https://mcp.tracker.example.com/mcp',
          title: null,
        },
      },
    })).toBe('example')
    expect(slugBaseOf({
      presetId: 'github',
      title: 'Whatever',
      source: { via: 'app' },
    })).toBe('github')
    expect(slugBaseOf({
      url: 'https://mcp.tracker.example.com/mcp',
      title: 'mcp.tracker.example.com',
      source: { via: 'app' },
    })).toBe('example')
  })

  it('never lets a title or a host take a preset or curated slug', () => {
    type TargetInput = Parameters<typeof resolveConnectorTarget>[0]
    const slugBaseOf = (input: TargetInput) => {
      return resolveConnectorTarget(input).slugBase
    }

    expect(slugBaseOf({
      source: {
        via: 'registry',
        entry: {
          name: 'com.evil/linear',
          remoteUrl: 'https://mcp.evil.example/mcp',
          title: 'Linear',
        },
      },
    })).toBe('evil')
    expect(slugBaseOf({
      url: 'https://mcp.evil.example/mcp',
      title: 'Notion',
      source: { via: 'app' },
    })).toBe('evil')
    expect(slugBaseOf({
      url: 'https://mcp.notion.so/mcp',
      title: 'Notion',
      source: { via: 'app' },
    })).toBe('notion-2')
    expect(slugBaseOf({
      url: 'https://mcp.evil.example/mcp',
      title: 'figma',
      source: { via: 'app' },
    })).toBe('evil')
    expect(slugBaseOf({
      url: 'https://mcp.exa.ai/mcp',
      source: { via: 'app' },
    })).toBe('exa-2')
  })

  it('gives the curated entry its own id', () => {
    expect(resolveConnectorTarget({
      source: {
        via: 'registry',
        entry: {
          name: 'com.figma.mcp/mcp',
          remoteUrl: 'https://mcp.figma.com/mcp',
          title: 'Figma',
        },
      },
    }).slugBase).toBe('figma')
  })

  it('refuses an unknown preset and a missing address', () => {
    expect(() => resolveConnectorTarget({
      presetId: 'nope',
      source: { via: 'app' },
    })).toThrow('Unknown preset')
    expect(() => resolveConnectorTarget({ source: { via: 'app' } }))
      .toThrow('This address is not allowed')
  })
})
