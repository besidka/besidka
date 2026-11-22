import { describe, expect, it } from 'vitest'
import {
  classifyRegistryEntry,
} from '~~/server/utils/connectors/registry-entry'
import {
  REGISTRY_UPDATED_AT,
  registryEntry,
} from '../../../../fixtures/mcp-registry/builders'

const NOT_ERASED = () => false

function upsertRow(options: Parameters<typeof registryEntry>[0]) {
  const outcome = classifyRegistryEntry(registryEntry(options), NOT_ERASED)

  if (outcome.kind !== 'upsert') {
    throw new Error(`Expected an upsert, got ${JSON.stringify(outcome)}`)
  }

  return outcome.row
}

describe('classifyRegistryEntry', () => {
  it('maps an active streamable-http entry to a row', () => {
    const row = upsertRow({
      name: 'io.example/linear',
      title: '  Linear  ',
      version: '2.1.0',
      remotes: [{
        type: 'streamable-http',
        url: 'https://mcp.linear.example.com/mcp',
        headers: [
          { name: 'Authorization', isSecret: true, value: 'Bearer {key}' },
          { name: 'authorization' },
          { name: 'Host' },
          { name: 'bad header name' },
          { name: 'X-Api-Key' },
        ],
      }],
    })

    expect(row).toEqual({
      id: 'io.example/linear@2.1.0',
      name: 'io.example/linear',
      title: 'Linear',
      description: 'io.example/linear description',
      remoteUrl: 'https://mcp.linear.example.com/mcp',
      remoteType: 'streamable-http',
      headerNames: ['Authorization', 'X-Api-Key'],
      status: 'active',
      registryUpdatedAt: new Date(REGISTRY_UPDATED_AT),
    })
  })

  it('truncates the description to 300 characters and strips controls', () => {
    const row = upsertRow({
      name: 'io.example/long',
      description: `Line\u0000one\n${'x'.repeat(400)}`,
    })

    expect(row.description).toHaveLength(300)
    expect(row.description.startsWith('Line one x')).toBe(true)
  })

  it('strips bidi, zero-width, tag and separator characters', () => {
    const row = upsertRow({
      name: 'io.example/hidden',
      title: 'Lin\u202Eear\u200B\u2066 App\u00AD',
      description: `Safe\u2028text\u2029here ${String.fromCodePoint(0xE0041, 0xE0042)}done\u200F`,
    })

    expect(row.title).toBe('Linear App')
    expect(row.description).toBe('Safe text here done')
  })

  it('cuts by code points and never splits a surrogate pair', () => {
    const row = upsertRow({
      name: 'io.example/emoji',
      title: '😀'.repeat(200),
      description: '😀'.repeat(400),
    })

    expect(Array.from(row.title!)).toHaveLength(120)
    expect(Array.from(row.description)).toHaveLength(300)
    expect(row.description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('uses the first remote that passes and skips sse', () => {
    const row = upsertRow({
      name: 'io.example/mixed',
      remotes: [
        { type: 'sse', url: 'https://sse.example.com/sse' },
        { type: 'streamable-http', url: 'http://plain.example.com/mcp' },
        { type: 'streamable-http', url: 'https://good.example.com/mcp' },
      ],
    })

    expect(row.remoteUrl).toBe('https://good.example.com/mcp')
  })

  it.each([
    ['sse only', [{ type: 'sse', url: 'https://sse.example.com/sse' }], 'no-remote'],
    ['no remotes', [], 'no-remote'],
    ['brace template', [{
      type: 'streamable-http',
      url: 'https://{tenant}.example.com/mcp',
    }], 'template'],
    ['encoded brace', [{
      type: 'streamable-http',
      url: 'https://example.com/%7Btenant%7D/mcp',
    }], 'template'],
    ['dollar template', [{
      type: 'streamable-http',
      url: 'https://example.com/${TENANT}/mcp',
    }], 'template'],
    ['http scheme', [{
      type: 'streamable-http',
      url: 'http://example.com/mcp',
    }], 'unsafe-url'],
    ['ip literal', [{
      type: 'streamable-http',
      url: 'https://203.0.113.9/mcp',
    }], 'unsafe-url'],
    ['localhost', [{
      type: 'streamable-http',
      url: 'https://localhost/mcp',
    }], 'unsafe-url'],
    ['credentials', [{
      type: 'streamable-http',
      url: 'https://user:pass@example.com/mcp',
    }], 'unsafe-url'],
    ['odd port', [{
      type: 'streamable-http',
      url: 'https://example.com:8080/mcp',
    }], 'unsafe-url'],
    ['own host', [{
      type: 'streamable-http',
      url: 'https://besidka.com/mcp',
    }], 'unsafe-url'],
  ])('skips %s', (_label, remotes, reason) => {
    expect(classifyRegistryEntry(
      registryEntry({ name: 'io.example/skip', remotes }),
      NOT_ERASED,
    )).toEqual({ kind: 'skip', name: 'io.example/skip', reason })
  })

  it('asks for the row to go when the entry is deleted upstream', () => {
    expect(classifyRegistryEntry(
      registryEntry({ name: 'io.example/gone', status: 'deleted' }),
      NOT_ERASED,
    )).toEqual({ kind: 'delete', name: 'io.example/gone' })
  })

  it('skips a deprecated entry', () => {
    expect(classifyRegistryEntry(
      registryEntry({ name: 'io.example/old', status: 'deprecated' }),
      NOT_ERASED,
    )).toEqual({ kind: 'skip', name: 'io.example/old', reason: 'inactive' })
  })

  it('skips an erased name', () => {
    expect(classifyRegistryEntry(
      registryEntry({ name: 'io.github.someone/tool' }),
      name => name === 'io.github.someone/tool',
    )).toEqual({
      kind: 'skip',
      name: 'io.github.someone/tool',
      reason: 'erased',
    })
  })

  it.each([
    ['not an object', 'text'],
    ['no server', { _meta: {} }],
    ['bad name', registryEntry({ name: 'x y' })],
    ['no official meta', { server: registryEntry({ name: 'io.example/a' }).server }],
    ['bad updatedAt', registryEntry({
      name: 'io.example/a',
      updatedAt: 'yesterday',
    })],
  ])('counts a %s entry as a shape mismatch', (_label, entry) => {
    expect(classifyRegistryEntry(entry, NOT_ERASED)).toMatchObject({
      kind: 'skip',
      reason: 'shape',
    })
  })
})
