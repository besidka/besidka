import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_BUDGET,
  KNOWLEDGE_CHARS_PER_TOKEN,
  KNOWLEDGE_LIMITS,
  getKnowledgeFileCategory,
  isIgnoredKnowledgePath,
  knowledgeDecisionModes,
  knowledgeDecisionReasons,
  knowledgeExtractStatuses,
  knowledgeExtractors,
  knowledgeIgnoredDirectories,
  knowledgeIgnoredFileNames,
  knowledgeItemKinds,
  knowledgeModes,
  knowledgeTokenFamilies,
  knowledgeUploadExtractStatuses,
} from '#shared/utils/project-knowledge-policy'

describe('knowledge enums', () => {
  it('lists the modes with auto first', () => {
    expect(knowledgeModes).toEqual(['auto', 'full', 'search'])
  })

  it('lists the decision modes and reasons', () => {
    expect(knowledgeDecisionModes).toEqual(['none', 'full', 'search'])
    expect(knowledgeDecisionReasons).toEqual([
      'empty',
      'forced-search',
      'within-budget',
      'over-budget',
      'hysteresis',
      'does-not-fit',
    ])
  })

  it('lists item kinds, extract statuses and extractors', () => {
    expect(knowledgeItemKinds).toEqual(['file', 'note'])
    expect(knowledgeExtractStatuses).toEqual([
      'ready',
      'no-text',
      'failed',
      'flagged',
    ])
    expect(knowledgeUploadExtractStatuses).toEqual([
      'ready',
      'no-text',
      'failed',
    ])
    expect(knowledgeExtractors).toEqual([
      'text',
      'client-unpdf',
      'client-mammoth',
      'client-xlsx',
      'transcribed',
      'worker-unpdf',
      'note',
    ])
  })

  it('lists the token families', () => {
    expect(knowledgeTokenFamilies).toEqual([
      'default',
      'anthropic',
      'openai',
      'google',
      'xai',
      'deepseek',
      'moonshotai',
      'qwen',
    ])
  })
})

describe('KNOWLEDGE_BUDGET', () => {
  it('matches the design constants', () => {
    expect(KNOWLEDGE_BUDGET).toEqual({
      contextWindowShare: 0.07,
      searchReturnShare: 0.85,
      absoluteCapTokens: 64_000,
      estimateMargin: 1.15,
      unknownContextWindowTokens: 128_000,
      defaultReservedOutputTokens: 16_384,
      maxReservedOutputTokens: 32_768,
      toolGroupTokens: 400,
    })
  })
})

describe('KNOWLEDGE_LIMITS', () => {
  it('keeps the size limits consistent with each other', () => {
    expect(KNOWLEDGE_LIMITS.maxItemTextBytes)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxProjectTextBytes)
    expect(KNOWLEDGE_LIMITS.maxBatchTextBytes)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxProjectTextBytes)
    expect(KNOWLEDGE_LIMITS.maxTextFileBytes)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxItemTextBytes)
    expect(KNOWLEDGE_LIMITS.maxFolderBytes)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxOriginalFileBytes)
    expect(KNOWLEDGE_LIMITS.maxFolderFiles)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxItemsPerProject)
    expect(KNOWLEDGE_LIMITS.maxItemsPerProject)
      .toBeLessThanOrEqual(KNOWLEDGE_LIMITS.maxItemsPerUser)
  })

  it('pins the headline values', () => {
    expect(KNOWLEDGE_LIMITS.maxItemsPerProject).toBe(500)
    expect(KNOWLEDGE_LIMITS.maxItemsPerUser).toBe(2000)
    expect(KNOWLEDGE_LIMITS.maxProjectTextBytes).toBe(2 * 1024 * 1024)
    expect(KNOWLEDGE_LIMITS.maxBatchTextBytes).toBe(1024 * 1024)
    expect(KNOWLEDGE_LIMITS.maxNoteChars).toBe(100_000)
    expect(KNOWLEDGE_LIMITS.maxDescriptionChars).toBe(100)
    expect(KNOWLEDGE_LIMITS.imageTokens).toBe(1600)
    expect(KNOWLEDGE_LIMITS.nativePdfPageTokens).toBe(2500)
    expect(KNOWLEDGE_LIMITS.searchQueryMaxChars).toBe(128)
  })
})

describe('KNOWLEDGE_CHARS_PER_TOKEN', () => {
  it('has an entry for every family', () => {
    for (const family of knowledgeTokenFamilies) {
      expect(KNOWLEDGE_CHARS_PER_TOKEN[family]).toBeDefined()
    }
  })

  it.each([
    ['default', { latin: 3.5, cyrillic: 1.5, other: 1.5 }],
    ['anthropic', { latin: 3.2, cyrillic: 1.1, other: 1 }],
    ['openai', { latin: 4, cyrillic: 2.3, other: 1.5 }],
    ['google', { latin: 3.5, cyrillic: 2.5, other: 1.5 }],
    ['xai', { latin: 3.5, cyrillic: 2, other: 1.5 }],
    ['deepseek', { latin: 3.9, cyrillic: 1.8, other: 1.5 }],
    ['moonshotai', { latin: 4, cyrillic: 1.8, other: 1.5 }],
    ['qwen', { latin: 3.9, cyrillic: 1.5, other: 1.5 }],
  ] as const)('sets the %s figures', (family, figures) => {
    expect(KNOWLEDGE_CHARS_PER_TOKEN[family]).toEqual(figures)
  })
})

describe('getKnowledgeFileCategory', () => {
  it.each([
    ['README.md', 'text'],
    ['notes.TXT', 'text'],
    ['src/app/main.ts', 'text'],
    ['component.vue', 'text'],
    ['data.csv', 'text'],
    ['schema.graphql', 'text'],
    ['Dockerfile', 'text'],
    ['infra/Makefile', 'text'],
    ['paper.pdf', 'document'],
    ['Report.DOCX', 'document'],
    ['sheet.xlsx', 'document'],
    ['photo.png', 'image'],
    ['photo.JPG', 'image'],
    ['photo.jpeg', 'image'],
    ['photo.webp', 'image'],
  ] as const)('categorizes %s as %s', (fileName, category) => {
    expect(getKnowledgeFileCategory(fileName)).toBe(category)
  })

  it.each([
    'archive.zip',
    'movie.mp4',
    'binary.exe',
    'noextension',
    '.gitignore',
    'trailingdot.',
    'dockerfile',
    'Dockerfile.bak',
    '',
  ])('returns null for %s', (fileName) => {
    expect(getKnowledgeFileCategory(fileName)).toBeNull()
  })

  it('uses the last extension of a multi-dot name', () => {
    expect(getKnowledgeFileCategory('archive.tar.md')).toBe('text')
    expect(getKnowledgeFileCategory('notes.md.zip')).toBeNull()
  })
})

describe('isIgnoredKnowledgePath', () => {
  it.each(knowledgeIgnoredFileNames)('ignores the file %s', (fileName) => {
    expect(isIgnoredKnowledgePath(fileName)).toBe(true)
    expect(isIgnoredKnowledgePath(`project/${fileName}`)).toBe(true)
  })

  it.each(knowledgeIgnoredDirectories)(
    'ignores files inside the directory %s',
    (directory) => {
      expect(isIgnoredKnowledgePath(`${directory}/file.ts`)).toBe(true)
      expect(isIgnoredKnowledgePath(`app/${directory}/deep/file.ts`))
        .toBe(true)
    },
  )

  it('accepts ordinary source paths', () => {
    expect(isIgnoredKnowledgePath('src/index.ts')).toBe(false)
    expect(isIgnoredKnowledgePath('docs/README.md')).toBe(false)
    expect(isIgnoredKnowledgePath('README.md')).toBe(false)
  })

  it('does not ignore a file that merely shares a directory name', () => {
    expect(isIgnoredKnowledgePath('docs/build')).toBe(false)
    expect(isIgnoredKnowledgePath('src/vendor.ts')).toBe(false)
  })

  it('handles backslash separators', () => {
    expect(isIgnoredKnowledgePath('app\\node_modules\\x.js')).toBe(true)
  })

  it('does not ignore an empty path', () => {
    expect(isIgnoredKnowledgePath('')).toBe(false)
  })
})
