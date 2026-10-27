import type { KnowledgeItem } from '../../../shared/types/project-knowledge.d'
import type { KnowledgeModelContext } from '../../../app/types/knowledge-ui.d'

export function createKnowledgeItem(
  overrides: Partial<KnowledgeItem> = {},
): KnowledgeItem {
  return {
    id: 'item-1',
    projectId: 'project-1',
    kind: 'file',
    fileId: null,
    title: 'README.md',
    description: null,
    relativePath: null,
    folderId: null,
    contentHash: null,
    mediaType: 'text/markdown',
    sizeBytes: 1024,
    pageCount: null,
    textBytes: 1024,
    latinChars: 1024,
    cyrillicChars: 0,
    otherChars: 0,
    extractStatus: 'ready',
    extractError: null,
    extractor: 'text',
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  }
}

export function createKnowledgeModelContext(
  overrides: Partial<KnowledgeModelContext> = {},
): KnowledgeModelContext {
  return {
    name: 'Test Model',
    family: 'default',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_000,
    acceptsImages: false,
    acceptsPdf: false,
    inputPrice: 3,
    cacheReadPrice: 0.3,
    isCachingAvailable: true,
    ...overrides,
  }
}

export function sumKnowledgeTotals(items: KnowledgeItem[]) {
  return items.reduce((totals, item) => {
    return {
      latinChars: totals.latinChars + item.latinChars,
      cyrillicChars: totals.cyrillicChars + item.cyrillicChars,
      otherChars: totals.otherChars + item.otherChars,
      textBytes: totals.textBytes + item.textBytes,
      items: totals.items + 1,
    }
  }, {
    latinChars: 0,
    cyrillicChars: 0,
    otherChars: 0,
    textBytes: 0,
    items: 0,
  })
}
