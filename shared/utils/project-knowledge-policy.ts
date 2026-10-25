import type {
  KnowledgeTokenFamily,
} from '#shared/types/project-knowledge.d'

export const knowledgeModes = ['auto', 'full', 'search'] as const

export const knowledgeDecisionModes = ['none', 'full', 'search'] as const

export const knowledgeDecisionReasons = [
  'empty',
  'forced-search',
  'within-budget',
  'over-budget',
  'does-not-fit',
] as const

export const knowledgeItemKinds = ['file', 'note'] as const

export const knowledgeExtractStatuses = ['ready', 'no-text', 'failed'] as const

export const knowledgeExtractors = [
  'text',
  'client-unpdf',
  'client-mammoth',
  'client-xlsx',
  'transcribed',
  'worker-unpdf',
  'note',
] as const

export const knowledgeTokenFamilies = [
  'default',
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'qwen',
] as const

export const KNOWLEDGE_BUDGET = {
  contextWindowShare: 0.07,
  absoluteCapTokens: 64_000,
  estimateMargin: 1.15,
  unknownContextWindowTokens: 128_000,
  defaultReservedOutputTokens: 16_384,
  maxReservedOutputTokens: 32_768,
  toolGroupTokens: 400,
} as const

export const KNOWLEDGE_LIMITS = {
  maxItemsPerProject: 500,
  maxProjectTextBytes: 2 * 1024 * 1024,
  maxItemTextBytes: 2 * 1024 * 1024,
  maxOriginalFileBytes: 30 * 1024 * 1024,
  maxTextFileBytes: 1024 * 1024,
  maxPdfPages: 500,
  maxNoteChars: 100_000,
  maxTitleChars: 200,
  maxDescriptionChars: 100,
  maxRelativePathChars: 512,
  maxFolderFiles: 500,
  maxFolderBytes: 20 * 1024 * 1024,
  maxFullInjectImages: 10,
  imageTokens: 1600,
  nativePdfPageTokens: 2500,
  maxNativePdfBytesPerSend: 20 * 1024 * 1024,
  indexTokenBudget: 2000,
  chunkTargetTokens: 512,
  chunkOverlapTokens: 64,
  toolCallsPerSend: 3,
  searchMaxChunks: 6,
  searchMaxTokens: 3000,
  readMaxChunks: 6,
  readMaxTokens: 4000,
  preRetrievalMaxChunks: 4,
  preRetrievalMaxTokens: 2000,
  searchQueryMaxChars: 128,
} as const

export const KNOWLEDGE_CHARS_PER_TOKEN: Record<
  KnowledgeTokenFamily,
  { latin: number, cyrillic: number, other: number }
> = {
  default: { latin: 3.5, cyrillic: 1.5, other: 1.5 },
  anthropic: { latin: 3.2, cyrillic: 1.1, other: 1 },
  openai: { latin: 4, cyrillic: 2.3, other: 1.5 },
  google: { latin: 3.5, cyrillic: 2.5, other: 1.5 },
  xai: { latin: 3.5, cyrillic: 2, other: 1.5 },
  deepseek: { latin: 3.9, cyrillic: 1.8, other: 1.5 },
  moonshotai: { latin: 4, cyrillic: 1.8, other: 1.5 },
  qwen: { latin: 3.9, cyrillic: 1.5, other: 1.5 },
}

export const knowledgeTextExtensions = [
  'md',
  'mdx',
  'txt',
  'csv',
  'tsv',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'css',
  'scss',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'vue',
  'svelte',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'sql',
  'graphql',
  'proto',
  'ini',
] as const

export const knowledgeTextFileNames = ['Dockerfile', 'Makefile'] as const

export const knowledgeDocumentExtensions = ['pdf', 'docx', 'xlsx'] as const

export const knowledgeImageExtensions = [
  'png',
  'jpg',
  'jpeg',
  'webp',
] as const

export const knowledgeIgnoredDirectories = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
  '__pycache__',
  '.venv',
] as const

export const knowledgeIgnoredFileNames = [
  '.DS_Store',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
] as const

function getPathSegments(relativePath: string): string[] {
  return relativePath
    .split(/[\\/]/)
    .filter(segment => segment.length > 0)
}

function getFileExtension(fileName: string): string | null {
  const separatorIndex = fileName.lastIndexOf('.')

  if (separatorIndex <= 0 || separatorIndex === fileName.length - 1) {
    return null
  }

  return fileName.slice(separatorIndex + 1).toLowerCase()
}

export function getKnowledgeFileCategory(
  fileName: string,
): 'text' | 'document' | 'image' | null {
  const baseName = getPathSegments(fileName).at(-1) ?? ''

  if ((knowledgeTextFileNames as readonly string[]).includes(baseName)) {
    return 'text'
  }

  const extension = getFileExtension(baseName)

  if (!extension) {
    return null
  }

  if ((knowledgeTextExtensions as readonly string[]).includes(extension)) {
    return 'text'
  }

  if ((knowledgeDocumentExtensions as readonly string[]).includes(extension)) {
    return 'document'
  }

  if ((knowledgeImageExtensions as readonly string[]).includes(extension)) {
    return 'image'
  }

  return null
}

export function isIgnoredKnowledgePath(relativePath: string): boolean {
  const segments = getPathSegments(relativePath)
  const fileName = segments.at(-1)

  if (!fileName) {
    return false
  }

  if ((knowledgeIgnoredFileNames as readonly string[]).includes(fileName)) {
    return true
  }

  return segments
    .slice(0, -1)
    .some((segment) => {
      return (knowledgeIgnoredDirectories as readonly string[])
        .includes(segment)
    })
}
