import { describe, expect, it } from 'vitest'
import {
  buildConnectorToolsReview,
  resolveAlwaysAllowHashes,
} from '~~/server/utils/connectors/tool-review'
import type { ConnectorToolDefinition } from '~~/server/utils/connectors/tool-definitions'

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)

function definition(
  name: string,
  annotations: ConnectorToolDefinition['annotations'] = {},
  title?: string,
): ConnectorToolDefinition {
  return {
    name,
    ...(title ? { title } : {}),
    description: `${name} tool`,
    inputSchema: { type: 'object' },
    annotations,
  }
}

function setting(
  toolName: string,
  overrides: Partial<{
    definitionHash: string
    enabled: boolean
    approval: string
    approvedDefinitionHash: string | null
  }> = {},
) {
  return {
    toolName,
    definitionHash: HASH,
    enabled: true,
    approval: 'ask',
    approvedDefinitionHash: null,
    ...overrides,
  }
}

describe('resolveAlwaysAllowHashes', () => {
  const definitions = [
    definition('search', { readOnlyHint: true }),
    definition('create_page'),
    definition('purge', { readOnlyHint: true }),
    definition('archive', { readOnlyHint: true, destructiveHint: true }),
    definition('file_access', { readOnlyHint: true }, 'Share file'),
    definition('changed', { readOnlyHint: true }),
  ]
  const hashes = new Map(definitions.map((item) => {
    return [item.name, item.name === 'changed' ? OTHER_HASH : HASH]
  }))
  const settings = definitions.map(item => setting(item.name))

  it('binds reads and plain writes to the reviewed hash', () => {
    expect(resolveAlwaysAllowHashes({
      definitions,
      hashes,
      settings,
      toolNames: ['search', 'create_page'],
    })).toEqual({
      hashes: new Map([['search', HASH], ['create_page', HASH]]),
      refused: [],
    })
  })

  it('refuses send, post, forward, reply and unshare tools and keeps reads '
    + 'named with plural nouns', () => {
    const names = ['send_email', 'sendMessage', 'post-comment',
      'forwardMessage', 'unshare_page', 'search_posts']
    const sendDefinitions = names.map((name) => {
      return definition(name, { readOnlyHint: true })
    })

    expect(resolveAlwaysAllowHashes({
      definitions: sendDefinitions,
      hashes: new Map(names.map(name => [name, HASH])),
      settings: names.map(name => setting(name)),
      toolNames: names,
    })).toEqual({
      hashes: new Map([['search_posts', HASH]]),
      refused: names.slice(0, 5),
    })
  })

  it('refuses the always-ask tier, whatever readOnlyHint says', () => {
    expect(resolveAlwaysAllowHashes({
      definitions,
      hashes,
      settings,
      toolNames: ['purge', 'archive', 'file_access'],
    }).refused).toEqual(['purge', 'archive', 'file_access'])
  })

  it('refuses a drifted, unknown or unreviewed tool', () => {
    expect(resolveAlwaysAllowHashes({
      definitions,
      hashes,
      settings: settings.filter(item => item.toolName !== 'create_page'),
      toolNames: ['changed', 'missing', 'create_page'],
    }).refused).toEqual(['changed', 'missing', 'create_page'])
  })
})

describe('buildConnectorToolsReview defaults', () => {
  it('defaults a plain read to Always allow and everything else to Needs '
    + 'approval, and keeps an explicit Needs approval', async () => {
    const definitions = [
      definition('search', { readOnlyHint: true }),
      definition('fetch_url', { readOnlyHint: true, openWorldHint: true }),
      definition('share_link', { readOnlyHint: true }),
      definition('pinned', { readOnlyHint: true }),
      definition('create_page'),
    ]
    const review = await buildConnectorToolsReview({
      definitions,
      hashes: new Map(definitions.map(item => [item.name, HASH])),
      isBaselined: true,
      settings: [
        setting('search'),
        setting('fetch_url'),
        setting('share_link'),
        setting('pinned', { approval: 'needs-approval' }),
        setting('create_page'),
      ],
    })

    expect(Object.fromEntries(review.tools.map((tool) => {
      return [tool.name, tool.mode]
    }))).toEqual({
      search: 'allow',
      fetch_url: 'ask',
      share_link: 'ask',
      pinned: 'ask',
      create_page: 'ask',
    })
  })
})

describe('buildConnectorToolsReview modes', () => {
  it('reports each reviewed tool mode and whether it can be Always allow',
    async () => {
      const definitions = [
        definition('search', { readOnlyHint: true }),
        definition('create_page'),
        definition('delete_page'),
        definition('changed'),
      ]
      const review = await buildConnectorToolsReview({
        definitions,
        hashes: new Map(definitions.map((item) => {
          return [item.name, item.name === 'changed' ? OTHER_HASH : HASH]
        })),
        isBaselined: true,
        settings: [
          setting('search', { approval: 'always', approvedDefinitionHash: HASH }),
          setting('create_page', { enabled: false }),
          setting('delete_page', {
            approval: 'always',
            approvedDefinitionHash: HASH,
          }),
          setting('changed', {
            approval: 'always',
            approvedDefinitionHash: HASH,
          }),
        ],
      })
      const byName = new Map(review.tools.map(tool => [tool.name, tool]))

      expect(byName.get('search')).toMatchObject({
        mode: 'allow',
        canAlwaysAllow: true,
      })
      expect(byName.get('create_page')).toMatchObject({
        mode: 'blocked',
        canAlwaysAllow: true,
      })
      expect(byName.get('delete_page')).toMatchObject({
        mode: 'ask',
        alwaysAsk: true,
        canAlwaysAllow: false,
      })
      expect(byName.get('changed')).toMatchObject({
        change: 'changed',
        mode: 'ask',
        canAlwaysAllow: false,
      })
    })
})
