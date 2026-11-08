import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_REPOSITORY,
  MCP_SERVER_ROUTE,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
} from '~~/config/mcp-server'
import { DEFAULT_SITE_URL } from '~~/config/site-url'

const MCP_REGISTRY_DESCRIPTION_LIMIT = 100
const SERVER_JSON_SCHEMA_URL
  = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json'

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf-8'))
}

const mcpUrl = `${DEFAULT_SITE_URL}${MCP_SERVER_ROUTE}`

describe('server.json', () => {
  const manifest = readJson('server.json')

  it('mirrors the MCP server identity constants', () => {
    expect(manifest.name).toBe(MCP_SERVER_NAME)
    expect(manifest.title).toBe(MCP_SERVER_TITLE)
    expect(manifest.version).toBe(MCP_SERVER_VERSION)
    expect(manifest.description).toBe(MCP_SERVER_DESCRIPTION)
    expect(manifest.repository).toEqual(MCP_SERVER_REPOSITORY)
  })

  it('uses the 2025-12-11 server schema', () => {
    expect(manifest.$schema).toBe(SERVER_JSON_SCHEMA_URL)
  })

  it('keeps the description within the registry limit', () => {
    expect(manifest.description.length)
      .toBeLessThanOrEqual(MCP_REGISTRY_DESCRIPTION_LIMIT)
    expect(MCP_SERVER_DESCRIPTION.length)
      .toBeLessThanOrEqual(MCP_REGISTRY_DESCRIPTION_LIMIT)
  })

  it('declares the single streamable HTTP remote', () => {
    expect(manifest.remotes).toEqual([
      { type: 'streamable-http', url: mcpUrl },
    ])
  })
})

describe('plugins/besidka', () => {
  it('points the plugin MCP config at the same endpoint', () => {
    const config = readJson('plugins/besidka/mcp.json')

    expect(config.mcpServers.besidka).toEqual({
      type: 'streamable-http',
      url: mcpUrl,
    })
  })

  it('shares the MCP server version', () => {
    const manifest = readJson('plugins/besidka/plugin.json')

    expect(manifest.version).toBe(MCP_SERVER_VERSION)
  })

  it('links to the site and repository', () => {
    const manifest = readJson('plugins/besidka/plugin.json')

    expect(manifest.homepage).toBe(DEFAULT_SITE_URL)
    expect(manifest.repository).toBe(MCP_SERVER_REPOSITORY.url)
  })

  it('references a logo asset that exists', () => {
    const manifest = readJson('plugins/besidka/plugin.json')
    const { logo, composerIcon } = manifest.extensions['com.openai'].interface

    expect(logo).toBe(composerIcon)
    expect(existsSync(join(process.cwd(), 'plugins/besidka', logo)))
      .toBe(true)
  })
})

describe('plugins/besidka/.cursor-plugin/plugin.json', () => {
  const manifest = readJson('plugins/besidka/.cursor-plugin/plugin.json')

  it('names the plugin and shares the MCP server version', () => {
    expect(manifest.name).toBe('besidka')
    expect(manifest.version).toBe(MCP_SERVER_VERSION)
  })

  it('references a logo that exists', () => {
    expect(existsSync(join(process.cwd(), 'plugins/besidka', manifest.logo)))
      .toBe(true)
  })

  it('shares one description across every manifest', () => {
    const agentPlugin = readJson('plugins/besidka/plugin.json')
    const marketplace = readJson('.cursor-plugin/marketplace.json')
    const entry = marketplace.plugins.find((plugin: { name: string }) => {
      return plugin.name === 'besidka'
    })

    expect(manifest.description).toBe(agentPlugin.description)
    expect(entry.description).toBe(agentPlugin.description)
  })
})

describe('.cursor-plugin/marketplace.json', () => {
  it('lists plugins whose source directories hold a plugin.json', () => {
    const marketplace = readJson('.cursor-plugin/marketplace.json')

    expect(marketplace.plugins.length).toBeGreaterThan(0)

    for (const plugin of marketplace.plugins) {
      const manifestPath = join(process.cwd(), plugin.source, 'plugin.json')

      expect(existsSync(manifestPath)).toBe(true)
    }
  })
})
