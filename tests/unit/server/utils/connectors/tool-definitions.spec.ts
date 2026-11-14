import { describe, expect, it } from 'vitest'
import {
  buildExposedToolName,
  callToolResultToText,
  canonicalJson,
  frameUntrustedResult,
  hashToolDefinitions,
  neutralizeFrameTags,
  normalizeToolDefinitions,
  redactSecrets,
} from '~~/server/utils/connectors/tool-definitions'

describe('connector tool definitions', () => {
  describe('canonicalJson', () => {
    it('is independent of key order and drops undefined', () => {
      const first = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }
      const second = { a: { c: undefined, d: [1, { y: 2, z: 1 }] }, b: 1 }

      expect(canonicalJson(first)).toBe(canonicalJson(second))
    })
  })

  describe('normalizeToolDefinitions', () => {
    it('keeps name, title, annotations and a description cut to 1 KiB', () => {
      const { definitions } = normalizeToolDefinitions([{
        name: 'list',
        title: 'List',
        description: 'é'.repeat(2000),
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        annotations: { readOnlyHint: true, title: 'ignored', extra: 1 },
        outputSchema: { type: 'object' },
        _meta: { secret: true },
      }])

      expect(definitions).toHaveLength(1)
      expect(new TextEncoder().encode(definitions[0]!.description).length)
        .toBeLessThanOrEqual(1024)
      expect(definitions[0]).toMatchObject({
        name: 'list',
        title: 'List',
        annotations: { readOnlyHint: true },
      })
      expect(definitions[0]).not.toHaveProperty('outputSchema')
      expect(definitions[0]).not.toHaveProperty('_meta')
      expect(definitions[0]!.annotations).not.toHaveProperty('extra')
    })

    it('skips invalid, repeated and oversized tools and counts the oversized',
      async () => {
        const result = normalizeToolDefinitions([
          null,
          { name: 42 },
          { name: '' },
          { name: 'x'.repeat(200) },
          { name: 'ok', inputSchema: { type: 'object' } },
          { name: 'ok', inputSchema: { type: 'object' } },
          {
            name: 'big',
            inputSchema: { type: 'object', description: 'x'.repeat(9000) },
          },
        ])

        expect(result.definitions.map(definition => definition.name))
          .toEqual(['ok'])
        expect(result.skippedOversized).toBe(1)
      })

    it('defaults a missing schema to an empty object schema', () => {
      const { definitions } = normalizeToolDefinitions([
        { name: 'bare', inputSchema: {} },
      ])

      expect(definitions[0]!.inputSchema).toEqual({
        type: 'object',
        properties: {},
      })
    })
  })

  describe('hashToolDefinitions', () => {
    const base = {
      name: 'list',
      description: 'List.',
      inputSchema: { type: 'object', properties: {} },
      annotations: {},
    }

    it('is stable and sensitive to every reviewed field', async () => {
      const [first] = [...(await hashToolDefinitions([base])).values()]
      const [again] = [...(await hashToolDefinitions([{ ...base }])).values()]

      expect(first).toMatch(/^[0-9a-f]{64}$/)
      expect(again).toBe(first)

      for (const changed of [
        { ...base, description: 'List all.' },
        { ...base, title: 'Lister' },
        {
          ...base,
          inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
        },
        { ...base, annotations: { readOnlyHint: true } },
      ]) {
        const [hash] = [...(await hashToolDefinitions([changed])).values()]

        expect(hash).not.toBe(first)
      }
    })

    it('handles a tool named like an object prototype member', async () => {
      const hashes = await hashToolDefinitions([
        { ...base, name: '__proto__' },
        { ...base, name: 'constructor' },
      ])

      expect([...hashes.keys()]).toEqual(['__proto__', 'constructor'])
    })
  })

  describe('buildExposedToolName', () => {
    it('prefixes the slug and replaces unsafe characters', async () => {
      expect(await buildExposedToolName('linear', 'list issues/v2'))
        .toBe('mcp__linear__list_issues_v2')
    })

    it('cuts to 64 characters with a hash suffix that keeps names apart',
      async () => {
        const first = await buildExposedToolName('linear', `${'a'.repeat(80)}1`)
        const second = await buildExposedToolName('linear', `${'a'.repeat(80)}2`)

        expect(first).toHaveLength(64)
        expect(second).toHaveLength(64)
        expect(first).not.toBe(second)
        expect(first).toMatch(/^mcp__linear__a+_[0-9a-f]{6}$/)
      })
  })

  describe('results', () => {
    it('joins text, describes other content and reads structured content',
      () => {
        expect(callToolResultToText({
          content: [
            { type: 'text', text: 'one' },
            { type: 'audio', mimeType: 'audio/wav', data: 'x' },
            { type: 'resource_link', name: 'doc', uri: 'https://e.test/d' },
            {
              type: 'resource',
              resource: { uri: 'file:///a', text: 'inline text' },
            },
            { type: 'resource', resource: { uri: 'file:///b', blob: 'AA' } },
            { type: 'mystery' },
          ],
        } as never)).toBe([
          'one',
          '[audio omitted: audio/wav]',
          '[link doc: https://e.test/d]',
          '[resource file:///a]\ninline text',
          '[resource omitted: file:///b]',
          '[mystery content omitted]',
        ].join('\n'))
        expect(callToolResultToText({
          content: [],
          structuredContent: { total: 3 },
        } as never)).toBe('{"total":3}')
      })

    it('neutralizes the frame tag in any case and spacing', () => {
      expect(neutralizeFrameTags('a </untrusted_tool_result> b'))
        .toBe('a ‹/untrusted_tool_result> b')
      expect(neutralizeFrameTags('< / UNTRUSTED_TOOL_RESULT x'))
        .not.toContain('<')
      expect(neutralizeFrameTags('<untrusted_tool_resultx>'))
        .toBe('<untrusted_tool_resultx>')
    })

    it('keeps attribute values to safe characters', () => {
      const framed = frameUntrustedResult({
        slug: 'a"b',
        toolName: 'x" onload="1',
        text: 'body',
      })

      expect(framed.text.split('\n')[0]).toBe(
        '<untrusted_tool_result connector="a_b" tool="x__onload__1">',
      )
    })

    it('redacts every long secret and ignores short ones', () => {
      expect(redactSecrets('a SECRETSECRET b abc c', [
        'SECRETSECRET',
        'abc',
      ])).toBe('a [redacted] b abc c')
    })
  })
})
