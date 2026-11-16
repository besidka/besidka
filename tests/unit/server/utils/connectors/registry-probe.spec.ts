import { describe, expect, it, vi } from 'vitest'
import { REGISTRY_PROBE_MAX_TOOLS } from '#shared/utils/connectors-policy'
import { buildDirectoryIndex } from '#shared/utils/connectors-directory'
import type { DirectoryEntry } from '#shared/utils/connectors-directory'
import {
  probeRegistryEntry,
  readCachedRegistryProbe,
  toDirectoryTools,
} from '~~/server/utils/connectors/registry-probe'
import { createFakeConnectorKv } from '../../../../setup/helpers/connectors-oauth'

function entryFor(patch: Record<string, unknown> = {}): DirectoryEntry {
  const index = buildDirectoryIndex([{
    id: 'io.example/open@1.0.0',
    name: 'io.example/open',
    title: 'Open',
    description: 'An open server that needs no sign-in',
    remoteUrl: 'https://mcp.open.example.com/mcp',
    headerNames: [],
    updatedAt: 1,
    ...patch,
  }])

  return index.entries.find(entry => !entry.id.startsWith('preset:'))!
}

function probeTtls(kv: ReturnType<typeof createFakeConnectorKv>) {
  return [...kv.ttls.entries()]
    .filter(([key]) => key.startsWith('connectors:registry:probe:'))
    .map(([, ttl]) => ttl)
}

function asKv(kv: ReturnType<typeof createFakeConnectorKv>) {
  return kv as unknown as Parameters<typeof probeRegistryEntry>[0]
}

describe('toDirectoryTools', () => {
  it('keeps plain text only and caps the list', () => {
    const tools = toDirectoryTools([
      { name: 'search‮', title: 'Search', description: 'Find\nthings\u0000' },
      { name: '' },
      'nope',
      ...Array.from({ length: 150 }, (_tool, index) => ({ name: `t${index}` })),
    ])

    expect(tools[0]).toEqual({
      name: 'search',
      title: 'Search',
      description: 'Find things',
    })
    expect(tools).toHaveLength(REGISTRY_PROBE_MAX_TOOLS)
  })
})

describe('probeRegistryEntry', () => {
  it('lists the tools of a server that answers without credentials', async () => {
    const kv = createFakeConnectorKv()
    const listTools = vi.fn(async () => [{ name: 'search', description: 'Find' }])
    const probeServer = vi.fn(async () => ({ status: 200, challenge: null }))
    const entry = entryFor()

    const probe = await probeRegistryEntry(asKv(kv), entry, {
      dependencies: { probeServer, listTools },
    })

    expect(probe).toMatchObject({
      authKind: 'none',
      state: 'listed',
      tools: [{ name: 'search', title: null, description: 'Find' }],
    })
    expect(probeServer).toHaveBeenCalledWith(
      'https://mcp.open.example.com/mcp',
      undefined,
    )
    expect(await readCachedRegistryProbe(asKv(kv), entry)).toEqual(probe)
  })

  it('tells OAuth from a key by the protected resource metadata', async () => {
    const probeServer = vi.fn(async () => ({ status: 401, challenge: null }))
    const listTools = vi.fn()

    expect(await probeRegistryEntry(asKv(createFakeConnectorKv()), entryFor(), {
      dependencies: {
        probeServer,
        listTools,
        findProtectedResource: async () => ({ resource: 'x' }),
      },
    })).toMatchObject({ authKind: 'oauth', state: 'needs-auth', tools: [] })
    expect(await probeRegistryEntry(asKv(createFakeConnectorKv()), entryFor(), {
      dependencies: {
        probeServer,
        listTools,
        findProtectedResource: async () => null,
      },
    })).toMatchObject({ authKind: 'header', state: 'needs-auth' })
    expect(listTools).not.toHaveBeenCalled()
  })

  it('never contacts a server that declares header names', async () => {
    const probeServer = vi.fn()

    expect(await probeRegistryEntry(
      asKv(createFakeConnectorKv()),
      entryFor({ headerNames: ['Authorization'] }),
      { dependencies: { probeServer } },
    )).toMatchObject({ authKind: 'header', state: 'needs-auth' })
    expect(probeServer).not.toHaveBeenCalled()
  })

  it('keeps a failure for an hour and a success for a day', async () => {
    const kv = createFakeConnectorKv()

    await probeRegistryEntry(asKv(kv), entryFor(), {
      dependencies: {
        probeServer: async () => {
          throw new Error('down')
        },
      },
    })

    expect(probeTtls(kv)).toEqual([3600])

    const okKv = createFakeConnectorKv()

    await probeRegistryEntry(asKv(okKv), entryFor(), {
      dependencies: {
        probeServer: async () => ({ status: 200, challenge: null }),
        listTools: async () => [],
      },
    })

    expect(probeTtls(okKv)).toEqual([86400])
  })

  it('answers unavailable for an unexpected status', async () => {
    expect(await probeRegistryEntry(asKv(createFakeConnectorKv()), entryFor(), {
      dependencies: {
        probeServer: async () => ({ status: 500, challenge: null }),
      },
    })).toMatchObject({ authKind: 'unknown', state: 'unavailable' })
  })

  it('probes one host about once per cooldown, across its entries', async () => {
    const kv = createFakeConnectorKv()
    const probeServer = vi.fn(async () => ({ status: 401, challenge: null }))
    const findProtectedResource = async () => null

    await probeRegistryEntry(asKv(kv), entryFor(), {
      dependencies: { probeServer, findProtectedResource },
    })

    const sibling = await probeRegistryEntry(asKv(kv), entryFor({
      id: 'io.example/open-two@1.0.0',
      name: 'io.example/open-two',
      remoteUrl: 'https://mcp.open.example.com/mcp?tools=two',
    }), { dependencies: { probeServer, findProtectedResource } })

    expect(probeServer).toHaveBeenCalledTimes(1)
    expect(sibling.state).toBe('unavailable')
    expect([...kv.values.keys()].filter((key) => {
      return key.startsWith('connectors:registry:probe:')
    })).toHaveLength(1)
  })

  it('shares one probe between concurrent requests for an entry', async () => {
    const kv = createFakeConnectorKv()
    const probeServer = vi.fn(async () => ({ status: 401, challenge: null }))
    const dependencies = {
      probeServer,
      findProtectedResource: async () => null,
    }

    const [first, second] = await Promise.all([
      probeRegistryEntry(asKv(kv), entryFor(), { dependencies }),
      probeRegistryEntry(asKv(kv), entryFor(), { dependencies }),
    ])

    expect(probeServer).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('probes again when the entry address changes', async () => {
    const kv = createFakeConnectorKv()
    const probeServer = vi.fn(async () => ({ status: 401, challenge: null }))
    const dependencies = {
      probeServer,
      findProtectedResource: async () => null,
    }

    await probeRegistryEntry(asKv(kv), entryFor(), { dependencies })

    const moved = entryFor({ remoteUrl: 'https://mcp.moved.example.com/mcp' })

    expect(await readCachedRegistryProbe(asKv(kv), moved)).toBeNull()

    await probeRegistryEntry(asKv(kv), moved, { dependencies })

    expect(probeServer).toHaveBeenLastCalledWith(
      'https://mcp.moved.example.com/mcp',
      undefined,
    )
  })
})
