import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import anthropic from '../../../providers/anthropic'
import deepseek from '../../../providers/deepseek'
import moonshotai from '../../../providers/moonshotai'
import qwen from '../../../providers/qwen'
import xai from '../../../providers/xai'
import {
  compareModelVersions,
  insertCuratedEntry,
  insertPinnedSpecEntry,
  listProposableTemplates,
  parseModelFamily,
  renderCuratedEntry,
} from '../../../scripts/detect-model-successors.mjs'

const repositoryRoot = resolve(__dirname, '../../..')
const providerIdPattern = /^ {6}id: '(.+)',$/gm
const specIdPattern = /^ {2}'(.+)',$/

function readRepositoryFile(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf-8')
}

function extractProviderIds(providerSource: string): string[] {
  return Array.from(
    providerSource.matchAll(providerIdPattern),
    match => match[1],
  )
}

function extractSpecIds(specSource: string): string[] {
  const lines = specSource.split('\n')
  const startIndex = lines.findIndex((line) => {
    return line.startsWith('const expectedModelIds = [')
  })
  const endIndex = lines.findIndex((line, index) => {
    return index > startIndex && line === ']'
  })

  return lines
    .slice(startIndex + 1, endIndex)
    .map(line => line.match(specIdPattern)?.[1])
    .filter((id): id is string => id !== undefined)
}

function buildSuccessorId(templateId: string): string {
  const parsedTemplate = parseModelFamily(templateId)!
  const bumpedVersion = parsedTemplate.version.replace(
    /\d+$/,
    lastSegment => String(Number(lastSegment) + 1),
  )

  return parsedTemplate.family.replace('{v}', bumpedVersion)
}

describe('insertPinnedSpecEntry', () => {
  const specWithToolsBlock = `import { describe } from 'vitest'

const expectedModelIds = [
  'grok-4.6',
  'grok-4.5',
  'grok-imagine-image-2.0',
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.6': ['web_search'],
  'grok-4.5': ['web_search'],
  'grok-imagine-image-2.0': [],
}

describe('curated provider', () => {})`

  const specWithoutToolsBlock = `const expectedModelIds = [
  'claude-opus-5',
  'claude-opus-4-8',
]

describe('curated provider', () => {})`

  it('inserts the new id before the template id', () => {
    const result = insertPinnedSpecEntry(
      specWithoutToolsBlock,
      'claude-opus-5',
      { newId: 'claude-opus-5-5', tools: ['web_search'] },
    )

    expect(result).toBe(`const expectedModelIds = [
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
]

describe('curated provider', () => {})`)
  })

  it('also inserts into the expected tools block when present', () => {
    const result = insertPinnedSpecEntry(
      specWithToolsBlock,
      'grok-4.6',
      { newId: 'grok-4.7', tools: ['web_search', 'x_search'] },
    )

    expect(result).toBe(`import { describe } from 'vitest'

const expectedModelIds = [
  'grok-4.7',
  'grok-4.6',
  'grok-4.5',
  'grok-imagine-image-2.0',
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.7': ['web_search', 'x_search'],
  'grok-4.6': ['web_search'],
  'grok-4.5': ['web_search'],
  'grok-imagine-image-2.0': [],
}

describe('curated provider', () => {})`)
  })

  it('renders an empty tools list', () => {
    const result = insertPinnedSpecEntry(
      specWithToolsBlock,
      'grok-4.5',
      { newId: 'grok-4.6-lite', tools: [] },
    )

    expect(result).toContain('\n  \'grok-4.6-lite\': [],\n  \'grok-4.5\': ')
  })

  it('matches the exact id and not a longer id sharing the prefix', () => {
    const specWithPrefixSibling = `const expectedModelIds = [
  'grok-4.60',
  'grok-4.6',
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.60': ['web_search'],
  'grok-4.6': [],
}`

    const result = insertPinnedSpecEntry(
      specWithPrefixSibling,
      'grok-4.6',
      { newId: 'grok-4.7', tools: [] },
    )

    expect(result).toBe(`const expectedModelIds = [
  'grok-4.60',
  'grok-4.7',
  'grok-4.6',
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.60': ['web_search'],
  'grok-4.7': [],
  'grok-4.6': [],
}`)
  })

  it('handles the tools block appearing before the ids block', () => {
    const specWithToolsFirst = `const expectedToolsById: Record<string, string[]> = {
  'grok-4.6': ['web_search'],
  'grok-4.5': [],
}

const expectedModelIds = [
  'grok-4.6',
  'grok-4.5',
]`

    const result = insertPinnedSpecEntry(
      specWithToolsFirst,
      'grok-4.5',
      { newId: 'grok-4.55', tools: ['web_search'] },
    )

    expect(result).toBe(`const expectedToolsById: Record<string, string[]> = {
  'grok-4.6': ['web_search'],
  'grok-4.55': ['web_search'],
  'grok-4.5': [],
}

const expectedModelIds = [
  'grok-4.6',
  'grok-4.55',
  'grok-4.5',
]`)
  })

  it('throws when the expectedModelIds block is missing', () => {
    expect(() => {
      insertPinnedSpecEntry('const other = []', 'grok-4.6', {
        newId: 'grok-4.7',
        tools: [],
      })
    }).toThrow('No "const expectedModelIds = [" block found in spec.')
  })

  it('throws when the template id is missing from the ids block', () => {
    expect(() => {
      insertPinnedSpecEntry(specWithoutToolsBlock, 'claude-opus-9', {
        newId: 'claude-opus-9-1',
        tools: [],
      })
    }).toThrow('No "claude-opus-9" entries in expectedModelIds found.')
  })

  it('throws when the template id is ambiguous in the ids block', () => {
    const ambiguousSpec = `const expectedModelIds = [
  'grok-4.6',
  'grok-4.6',
]`

    expect(() => {
      insertPinnedSpecEntry(ambiguousSpec, 'grok-4.6', {
        newId: 'grok-4.7',
        tools: [],
      })
    }).toThrow('Ambiguous match: found 2 of "grok-4.6" entries')
  })

  it('throws when the template is missing from the expected tools block', () => {
    const specMissingToolsEntry = specWithToolsBlock.replace(
      '  \'grok-4.6\': [\'web_search\'],\n',
      '',
    )

    expect(() => {
      insertPinnedSpecEntry(specMissingToolsEntry, 'grok-4.6', {
        newId: 'grok-4.7',
        tools: [],
      })
    }).toThrow('No "grok-4.6" entries in expectedToolsById found.')
  })

  it('throws when the template is ambiguous in the expected tools block', () => {
    const specWithDuplicateToolsEntry = specWithToolsBlock.replace(
      '  \'grok-4.5\': [\'web_search\'],\n',
      '  \'grok-4.6\': [\'web_search\'],\n',
    )

    expect(() => {
      insertPinnedSpecEntry(specWithDuplicateToolsEntry, 'grok-4.6', {
        newId: 'grok-4.7',
        tools: [],
      })
    }).toThrow('Ambiguous match: found 2 of "grok-4.6" entries')
  })
})

describe('proposer splice rehearsal over the real provider files', () => {
  const rehearsedProviders = [
    { id: 'anthropic', provider: anthropic },
    { id: 'xai', provider: xai },
    { id: 'deepseek', provider: deepseek },
    { id: 'moonshotai', provider: moonshotai },
    { id: 'qwen', provider: qwen },
  ]

  describe.each(rehearsedProviders)('$id', ({ id, provider }) => {
    const proposableTemplates = listProposableTemplates(provider)

    if (proposableTemplates.length === 0) {
      it.skip('has no proposable template, so nothing is rehearsed', () => {})

      return
    }

    it.each(proposableTemplates)(
      'splices a higher-version successor of $template.id into source '
      + 'and spec',
      ({ template }) => {
        const providerSource = readRepositoryFile(`providers/${id}.ts`)
        const specSource = readRepositoryFile(
          `tests/unit/providers/${id}.spec.ts`,
        )
        const successorId = buildSuccessorId(template.id)
        const parsedTemplate = parseModelFamily(template.id)!
        const parsedSuccessor = parseModelFamily(successorId)!

        expect(parsedSuccessor.family).toBe(parsedTemplate.family)
        expect(
          compareModelVersions(
            parsedSuccessor.version,
            parsedTemplate.version,
          ),
        ).toBeGreaterThan(0)

        const splicedProviderSource = insertCuratedEntry(
          providerSource,
          template.id,
          renderCuratedEntry({ id: successorId, template }),
        )
        const splicedSpecSource = insertPinnedSpecEntry(
          specSource,
          template.id,
          { newId: successorId, tools: template.tools },
        )
        const splicedProviderIds = extractProviderIds(splicedProviderSource)
        const splicedSpecIds = extractSpecIds(splicedSpecSource)

        expect(splicedProviderIds).toContain(successorId)
        expect(new Set(splicedSpecIds)).toEqual(new Set(splicedProviderIds))
        expect(splicedProviderIds.at(-1)).toBe(
          extractProviderIds(providerSource).at(-1),
        )

        if (specSource.includes('const expectedToolsById')) {
          expect(splicedSpecSource).toContain(`\n  '${successorId}': [`)
        }
      },
    )
  })
})
