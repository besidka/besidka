import { describe, expect, it } from 'vitest'
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import type { KnowledgeModelContext } from '~/types/knowledge-ui.d'
import {
  buildKnowledgeMeterCopy,
  computeKnowledgeMeter,
  describeKnowledgeExtractError,
  describeKnowledgeFailureDetails,
  estimateKnowledgeItemTokens,
  formatKnowledgeBytes,
  getKnowledgeItemName,
  getKnowledgeItemTypeLabel,
  groupKnowledgeItems,
  isKnowledgePdf,
} from '~/utils/project-knowledge-ui'

function createItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
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
    sizeBytes: 1000,
    pageCount: null,
    textBytes: 1000,
    latinChars: 1000,
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

function createModel(
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

function totalsOf(items: KnowledgeItem[]) {
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

function meterFor(
  items: KnowledgeItem[],
  model: KnowledgeModelContext,
  mode: 'auto' | 'full' | 'search' = 'auto',
) {
  return computeKnowledgeMeter({
    totals: totalsOf(items),
    items,
    mode,
    model,
  })
}

describe('project-knowledge-ui', () => {
  describe('describeKnowledgeFailureDetails', () => {
    it('joins the why and the fix', () => {
      expect(describeKnowledgeFailureDetails({ why: 'Full', fix: 'Remove' }))
        .toBe('Full Remove')
    })

    it('returns whichever detail exists', () => {
      expect(describeKnowledgeFailureDetails({ why: 'Full' })).toBe('Full')
      expect(describeKnowledgeFailureDetails({ fix: 'Remove' }))
        .toBe('Remove')
    })

    it('returns undefined without details', () => {
      expect(describeKnowledgeFailureDetails({ why: '', fix: undefined }))
        .toBeUndefined()
    })
  })

  describe('item labels', () => {
    it('names an item by its relative path, then its title', () => {
      expect(getKnowledgeItemName(createItem({ relativePath: 'src/a.ts' })))
        .toBe('src/a.ts')
      expect(getKnowledgeItemName(createItem())).toBe('README.md')
    })

    it.each([
      [{ kind: 'note', extractor: 'note' }, 'Note'],
      [{ mediaType: 'application/pdf', fileId: 'file-1' }, 'PDF'],
      [{ extractor: 'client-mammoth', title: 'plan' }, 'DOCX'],
      [{ title: 'budget.xlsx', extractor: 'client-xlsx' }, 'Sheet'],
      [{ mediaType: 'image/png', fileId: 'file-2', title: 'shot' }, 'Image'],
      [{ title: 'a.ts' }, 'Text'],
    ] as const)('labels %j as %s', (overrides, label) => {
      expect(getKnowledgeItemTypeLabel(createItem(overrides))).toBe(label)
    })

    it('treats only linked PDFs as PDFs for native sending', () => {
      expect(isKnowledgePdf(createItem({
        mediaType: 'application/pdf',
        fileId: 'file-1',
      }))).toBe(true)
      expect(isKnowledgePdf(createItem({ mediaType: 'application/pdf' })))
        .toBe(false)
    })

    it('formats bytes without a trailing .0', () => {
      expect(formatKnowledgeBytes(2 * 1024 * 1024)).toBe('2 MB')
      expect(formatKnowledgeBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
      expect(formatKnowledgeBytes(800)).toBe('800 B')
      expect(formatKnowledgeBytes(-5)).toBe('0 B')
    })

    it('maps extract error codes to readable text', () => {
      expect(describeKnowledgeExtractError('ios-update-required')).toBe(
        'Update iOS to extract PDFs, or add it as a PDF for models that '
        + 'read PDFs.',
      )
      expect(describeKnowledgeExtractError('too-large'))
        .toContain('too large')
      expect(describeKnowledgeExtractError('too-many-pages'))
        .toContain(String(KNOWLEDGE_LIMITS.maxPdfPages))
      expect(describeKnowledgeExtractError('binary')).toContain('binary')
      expect(describeKnowledgeExtractError('not-utf8')).toContain('UTF-8')
      expect(describeKnowledgeExtractError('unsupported'))
        .toContain('not supported')
      expect(describeKnowledgeExtractError('something-new'))
        .toBe('Besidka could not read this file.')
      expect(describeKnowledgeExtractError(null))
        .toBe('Besidka could not read this file.')
      expect(describeKnowledgeExtractError('Upload failed with a message'))
        .toBe('Upload failed with a message')
    })
  })

  describe('groupKnowledgeItems', () => {
    it('groups folder items and keeps the rest loose', () => {
      const items = [
        createItem({ id: 'a', folderId: 'folder-1', relativePath: 'b.ts' }),
        createItem({ id: 'b', title: 'loose' }),
        createItem({ id: 'c', folderId: 'folder-1', relativePath: 'a.ts' }),
        createItem({ id: 'd', folderId: 'folder-2', relativePath: 'x.md' }),
      ]
      const { groups, looseItems } = groupKnowledgeItems(items, {
        'folder-1': 'my-project',
      })

      expect(looseItems.map(item => item.id)).toEqual(['b'])
      expect(groups.map(group => group.name)).toEqual([
        'my-project',
        'Folder 2',
      ])
      expect(groups[0]?.items.map(item => item.id)).toEqual(['c', 'a'])
    })
  })

  describe('computeKnowledgeMeter', () => {
    it('keeps a small knowledge base within budget', () => {
      const state = meterFor([createItem()], createModel())

      expect(state.tokens).toBe(Math.ceil(1000 / 3.5))
      expect(state.decision.mode).toBe('full')
      expect(state.isOverBudget).toBe(false)
      expect(state.budgetTokens).toBe(64_000)
      expect(state.percentage).toBe(Math.round(state.tokens / 64_000 * 100))
    })

    it('goes over the budget of a small context window', () => {
      const items = [createItem({ latinChars: 70_000 })]
      const state = meterFor(items, createModel({ contextWindow: 128_000 }))

      expect(state.budgetTokens).toBe(8960)
      expect(state.isOverBudget).toBe(true)
      expect(state.decision.mode).toBe('search')
      expect(state.decision.reason).toBe('over-budget')
      expect(state.fillPercentage).toBe(100)
      expect(state.percentage).toBeGreaterThan(100)
    })

    it('assumes 128k when the context window is unknown', () => {
      const state = meterFor([createItem()], createModel({
        contextWindow: null,
      }))

      expect(state.contextWindowKnown).toBe(false)
      expect(state.contextWindow).toBe(128_000)
      expect(state.budgetTokens).toBe(8960)
    })

    it('counts Cyrillic text with the family ratio', () => {
      const latin = meterFor([createItem()], createModel({
        family: 'anthropic',
      }))
      const cyrillic = meterFor([
        createItem({ latinChars: 0, cyrillicChars: 1000 }),
      ], createModel({ family: 'anthropic' }))

      expect(cyrillic.tokens).toBeGreaterThan(latin.tokens * 2)
    })

    it('swaps a native PDF to page tokens only on a PDF model', () => {
      const pdf = createItem({
        id: 'pdf',
        fileId: 'file-1',
        mediaType: 'application/pdf',
        pageCount: 4,
        sendAsNativePdf: true,
        latinChars: 3500,
      })
      const textOnly = meterFor([pdf], createModel())
      const native = meterFor([pdf], createModel({ acceptsPdf: true }))

      expect(textOnly.tokens).toBe(1000)
      expect(native.tokens).toBe(4 * KNOWLEDGE_LIMITS.nativePdfPageTokens)
    })

    it('adds image tokens only on a vision model, capped at ten', () => {
      const images = Array.from({ length: 12 }, (_value, index) => {
        return createItem({
          id: `image-${index}`,
          fileId: `file-${index}`,
          mediaType: 'image/png',
          latinChars: 0,
          textBytes: 0,
        })
      })
      const blind = meterFor(images, createModel())
      const vision = meterFor(images, createModel({ acceptsImages: true }))

      expect(blind.tokens).toBe(0)
      expect(vision.tokens).toBe(
        KNOWLEDGE_LIMITS.maxFullInjectImages * KNOWLEDGE_LIMITS.imageTokens,
      )
    })

    it('prices a message with and without caching', () => {
      const items = [createItem({ latinChars: 3_500_000 })]
      const cached = meterFor(items, createModel())
      const uncachedGateway = meterFor(items, createModel({
        isCachingAvailable: false,
      }))
      const unpriced = meterFor(items, createModel({ inputPrice: null }))

      expect(cached.perMessageCost).toBeCloseTo(3)
      expect(cached.perMessageCachedCost).toBeCloseTo(0.3)
      expect(uncachedGateway.perMessageCachedCost).toBeNull()
      expect(unpriced.perMessageCost).toBeNull()
      expect(unpriced.perMessageCachedCost).toBeNull()
    })

    it('reports a forced include that does not fit', () => {
      const items = [createItem({ latinChars: 3_500_000 })]
      const state = meterFor(items, createModel({
        contextWindow: 100_000,
      }), 'full')

      expect(state.decision.notice).toBe('full-does-not-fit')
      expect(state.decision.mode).toBe('search')
    })
  })

  describe('estimateKnowledgeItemTokens', () => {
    it('estimates one item for the current model', () => {
      expect(estimateKnowledgeItemTokens(createItem(), createModel()))
        .toBe(Math.ceil(1000 / 3.5))
    })
  })

  describe('buildKnowledgeMeterCopy', () => {
    function copyFor(
      items: KnowledgeItem[],
      model: KnowledgeModelContext,
      mode: 'auto' | 'full' | 'search' = 'auto',
    ) {
      return buildKnowledgeMeterCopy({
        state: meterFor(items, model, mode),
        mode,
        modelName: model.name,
      })
    }

    it('describes the within-budget case with cost per message', () => {
      const copy = copyFor(
        [createItem({ latinChars: 35_000 })],
        createModel(),
      )

      expect(copy.headline).toBe('Project knowledge · 10k tokens')
      expect(copy.barLabel).toBe(
        '16% of Test Model\'s full-context budget (64k)',
      )
      expect(copy.summary).toBe('All files are sent with every message')
      expect(copy.costLine).toBe(
        '≈ $0.030 per message, < $0.01 when cached',
      )
      expect(copy.warning).toBeNull()
    })

    it('describes the over-budget case', () => {
      const copy = copyFor(
        [createItem({ latinChars: 70_000 })],
        createModel({ contextWindow: 128_000 }),
      )

      expect(copy.barLabel).toBe('over Test Model\'s budget (9k)')
      expect(copy.summary).toBe(
        'Test Model searches the files when needed · switch to a larger '
        + 'model to include everything',
      )
      expect(copy.costLine).toBeNull()
    })

    it('says so when the mode is forced to search', () => {
      const copy = copyFor([createItem()], createModel(), 'search')

      expect(copy.summary).toContain('Always search is on')
      expect(copy.costLine).toBeNull()
    })

    it('warns when a forced include is above the budget', () => {
      const copy = copyFor(
        [createItem({ latinChars: 400_000 })],
        createModel(),
        'full',
      )

      expect(copy.summary).toContain('Always include is on')
      expect(copy.warning).toContain('above the recommended budget')
    })

    it('warns when a forced include does not fit', () => {
      const copy = copyFor(
        [createItem({ latinChars: 3_500_000 })],
        createModel({ contextWindow: 100_000 }),
        'full',
      )

      expect(copy.warning).toContain('does not fit')
      expect(copy.summary).toContain('searches the files when needed')
    })

    it('notes an unknown context window', () => {
      const copy = copyFor([createItem()], createModel({
        contextWindow: null,
      }))

      expect(copy.warning).toBe('Context window unknown, assuming 128k')
    })

    it('shows a neutral line for an empty project', () => {
      const copy = copyFor([], createModel())

      expect(copy.summary).toBe('Nothing is sent yet')
      expect(copy.headline).toBe('Project knowledge · 0 tokens')
    })
  })
})
