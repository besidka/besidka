import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_CURATION_VERSION,
  CURATED_CONNECTORS,
} from '~~/config/connectors-directory'
import type { CuratedConnector } from '~~/config/connectors-directory'
import { CONNECTOR_PRESETS } from '~~/config/connectors-catalog'
import {
  buildDirectoryIndex,
  categorizeDirectoryEntry,
  compactDirectoryText,
  countDirectoryCategories,
  directoryUrlKey,
  findDirectoryExclusion,
  isOfficialRegistryEntry,
  isPublicDirectoryUrl,
  listNewDirectoryEntries,
  listTopDirectoryEntries,
  normalizeDirectoryText,
  prepareDirectoryQuery,
  rankDirectoryEntry,
  buildDirectorySearchKeys,
  searchDirectoryIndex,
} from '#shared/utils/connectors-directory'
import type { DirectorySourceRow } from '#shared/utils/connectors-directory'

function row(
  name: string,
  patch: Partial<DirectorySourceRow> = {},
): DirectorySourceRow {
  const segment = name.split('/').at(-1) ?? name

  return {
    id: `${name}@1.0.0`,
    name,
    title: segment,
    description: `The ${segment} server, written for the tests`,
    remoteUrl: `https://mcp.${segment}.example.com/mcp`,
    headerNames: [],
    updatedAt: 1000,
    ...patch,
  }
}

const curated = CURATED_CONNECTORS as readonly CuratedConnector[]

describe('text normalization', () => {
  it('folds case and accents', () => {
    expect(normalizeDirectoryText('Vérif ÉTÉ Ångström')).toBe('verif ete angstrom')
  })

  it('compacts away spaces, hyphens and dots', () => {
    expect(compactDirectoryText('Hugging-Face hub.v2')).toBe('huggingfacehubv2')
  })
})

describe('isOfficialRegistryEntry', () => {
  it.each([
    ['com.notion/mcp', 'https://mcp.notion.com/mcp'],
    ['app.linear/linear', 'https://mcp.linear.app/mcp'],
    ['com.figma.mcp/mcp', 'https://mcp.figma.com/mcp'],
    ['app.vercel.myproj/x', 'https://myproj.vercel.app/api/mcp'],
  ])('marks %s on %s', (name, url) => {
    expect(isOfficialRegistryEntry(name, url)).toBe(true)
  })

  it.each([
    ['com.insightfulpipe/notion', 'https://notion.insightfulmcp.com/'],
    ['io.github.acme/tool', 'https://acme.github.io/mcp'],
    ['com.example.docs/x', 'https://mcp.example.com/mcp'],
    ['com.notion/mcp', 'https://notion.com.evil.net/mcp'],
    ['nonamespace/x', 'https://x.example.com'],
    ['com.notion/mcp', 'not a url'],
  ])('does not mark %s on %s', (name, url) => {
    expect(isOfficialRegistryEntry(name, url)).toBe(false)
  })
})

describe('quality filter', () => {
  it('keeps a titled entry with a real description', () => {
    expect(findDirectoryExclusion(row('io.example/good'))).toBeNull()
  })

  it.each([
    ['no-title', { title: null }],
    ['no-title', { title: '   ' }],
    ['short-description', { description: 'Short one' }],
    ['not-https', { remoteUrl: 'http://mcp.example.com/mcp' }],
    ['not-public', { remoteUrl: 'https://10.0.0.1/mcp' }],
    ['not-public', { remoteUrl: 'https://intranet/mcp' }],
    ['not-public', { remoteUrl: 'https://server.local/mcp' }],
    ['not-public', { remoteUrl: 'https://abc.trycloudflare.com/mcp' }],
    ['not-public', { remoteUrl: 'https://x.ngrok-free.app/mcp' }],
  ])('excludes %s for %o', (reason, patch) => {
    expect(findDirectoryExclusion(row('io.example/bad', patch))).toBe(reason)
  })

  it('lets a curated entry through without a registry title or description', () => {
    expect(findDirectoryExclusion(
      row('com.jotform/mcp', { title: null, description: 'Jotform MCP' }),
      { title: 'Jotform' },
    )).toBeNull()
    expect(isPublicDirectoryUrl('https://[::1]/mcp')).toBe(false)
  })

  it('collapses duplicate addresses and keeps the official, newer one', () => {
    const index = buildDirectoryIndex([
      row('io.github.someone/copy', {
        remoteUrl: 'https://mcp.acme.com/mcp/',
        updatedAt: 9000,
      }),
      row('com.acme/mcp', { remoteUrl: 'https://MCP.acme.com/mcp' }),
    ])
    const entries = index.entries.filter(entry => !entry.presetId)

    expect(entries.map(entry => entry.name)).toEqual(['com.acme/mcp'])
    expect(index.excluded.duplicate).toBe(1)
    expect(directoryUrlKey('https://MCP.acme.com/mcp/'))
      .toBe(directoryUrlKey('https://mcp.acme.com/mcp'))
  })
})

describe('categorizeDirectoryEntry', () => {
  it.each([
    ['Invoice tool', 'Send invoices and take payments', 'finance-payments'],
    ['Repo bot', 'Review pull requests in a repository', 'developer-tools'],
    ['Inbox', 'Read and send email from your inbox', 'communication'],
    ['Canvas', 'Edit Figma designs and prototypes', 'design'],
    ['Tracker', 'Create issues and plan sprints', 'project-management'],
    ['Crawler', 'Scrape and crawl any website', 'search-web'],
    ['Thing', 'Something without any known word', 'other'],
  ])('puts "%s: %s" in %s', (title, description, category) => {
    expect(categorizeDirectoryEntry({
      title,
      name: 'io.example/x',
      description,
    })).toBe(category)
  })

  it('weighs the title over the description', () => {
    expect(categorizeDirectoryEntry({
      title: 'Payments',
      name: 'io.example/x',
      description: 'An email and chat helper',
    })).toBe('finance-payments')
  })

  it('is deterministic and only uses known category ids', () => {
    const ids = new Set(CONNECTOR_CATEGORIES.map(category => category.id))
    const input = {
      title: 'Data',
      name: 'io.example/db',
      description: 'Query your SQL database',
    }

    const category = categorizeDirectoryEntry(input)

    expect(categorizeDirectoryEntry(input)).toBe(category)
    expect(ids.has(category)).toBe(true)
  })

  it('counts entries per category', () => {
    const index = buildDirectoryIndex([
      row('io.example/a', { description: 'Send invoices and take payments' }),
      row('io.example/b', { description: 'Track expenses and invoices fast' }),
    ])

    expect(countDirectoryCategories(index).get('finance-payments')).toBe(2)
  })
})

describe('search ranking', () => {
  function rankOf(title: string, query: string, patch = {}) {
    const index = buildDirectoryIndex([row('io.example/x', { title, ...patch })])
    const entry = index.entries.find(item => item.name === 'io.example/x')!

    return rankDirectoryEntry(
      buildDirectorySearchKeys(entry),
      prepareDirectoryQuery(query),
    )
  }

  it('orders exact, prefix, word, name, then description matches', () => {
    expect(rankOf('Notion', 'notion')).toBe(0)
    expect(rankOf('Notion Pages', 'notion')).toBe(1)
    expect(rankOf('My Notion', 'notion')).toBe(2)
    expect(rankOf('Thing', 'mcp')).toBe(3)
    expect(rankOf('Thing', 'tests')).toBe(4)
    expect(rankOf('Thing', 'zzz')).toBeNull()
  })

  it('tolerates a missing or extra space or hyphen and accents', () => {
    expect(rankOf('Hugging Face', 'huggingface')).toBe(0)
    expect(rankOf('HuggingFace', 'hugging face')).toBe(0)
    expect(rankOf('Hugging-Face', 'hugging face')).toBe(0)
    expect(rankOf('Vérif', 'VERIF')).toBe(0)
  })

  it('needs every word to match somewhere', () => {
    expect(rankOf('Notion', 'notion pages')).toBeNull()
    expect(rankOf('Notion', 'notion server')).toBe(4)
  })

  it('sorts results by rank, then official, then curated and title', () => {
    const index = buildDirectoryIndex([
      row('io.github.x/notion-helper', { title: 'Notion helper' }),
      row('com.notion/mcp', {
        title: null,
        remoteUrl: 'https://mcp.notion.com/mcp',
        description: 'Official Notion MCP server',
      }),
      row('com.helper/notion', {
        title: 'Notion helper pro',
        remoteUrl: 'https://notion.helper.com/mcp',
      }),
    ])

    expect(searchDirectoryIndex(index, 'notion').map(entry => entry.title))
      .toEqual(['Notion', 'Notion helper pro', 'Notion helper'])
  })
})

describe('curated list', () => {
  it('has a version, unique ids and names, and a source per entry', () => {
    expect(CONNECTOR_CURATION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Set(curated.map(entry => entry.id)).size).toBe(curated.length)

    const names = curated
      .map(entry => entry.registryName)
      .filter((name): name is string => !!name)

    expect(new Set(names).size).toBe(names.length)

    for (const entry of curated) {
      expect(!!entry.registryName !== !!entry.presetId).toBe(true)
      expect(entry.title.trim()).toBe(entry.title)
    }
  })

  it('names only presets that exist', () => {
    const presetIds = new Set(CONNECTOR_PRESETS.map(preset => preset.id))

    for (const entry of curated) {
      if (entry.presetId) {
        expect(presetIds.has(entry.presetId)).toBe(true)
      }
    }
  })

  it('resolves to mirror rows in curation order, with curated titles, and '
    + 'adds a preset that the mirror lacks', () => {
    const index = buildDirectoryIndex([
      row('app.linear/linear', {
        title: null,
        remoteUrl: 'https://mcp.linear.app/mcp',
      }),
      row('com.notion/mcp', {
        title: null,
        remoteUrl: 'https://mcp.notion.com/mcp',
        description: 'Official Notion MCP server',
      }),
      row('io.example/plain'),
    ])

    expect(listTopDirectoryEntries(index).map(entry => [
      entry.title,
      entry.presetId,
    ])).toEqual([
      ['GitHub', 'github'],
      ['Notion', 'notion'],
      ['Linear', 'linear'],
    ])
    expect(index.byId.get('preset:github')?.remoteUrl)
      .toBe('https://api.githubcopilot.com/mcp/')
  })

  it('skips a curated entry that is missing from the mirror', () => {
    const index = buildDirectoryIndex([row('io.example/plain')])

    expect(listTopDirectoryEntries(index).map(entry => entry.id))
      .toEqual(['preset:github'])
  })
})

describe('listNewDirectoryEntries', () => {
  it('orders by registry update time and skips untitled and preset entries', () => {
    const index = buildDirectoryIndex([
      row('io.example/old', { updatedAt: 1000 }),
      row('io.example/new', { updatedAt: 5000 }),
      row('com.notion/mcp', {
        title: null,
        remoteUrl: 'https://mcp.notion.com/mcp',
        description: 'Official Notion MCP server',
        updatedAt: 9000,
      }),
    ])

    expect(listNewDirectoryEntries(index).map(entry => entry.name))
      .toEqual(['io.example/new', 'io.example/old'])
  })
})
