import { describe, expect, it } from 'vitest'
import {
  renderDiagramSvg,
  toDiagramRenderError,
} from '~/utils/diagram-render-core'
import type { DiagramRenderResult } from '~/types/diagram.d'
import peleExamples from '../../fixtures/pele-examples.json'

interface PeleExample {
  id: string
  type: string
  title: string
  source: string
}

const examples: PeleExample[] = peleExamples

async function renderExample(
  example: PeleExample,
  maxWidth: number,
): Promise<DiagramRenderResult> {
  try {
    return { svg: await renderDiagramSvg(example.source, maxWidth) }
  } catch (exception) {
    return { error: toDiagramRenderError(exception) }
  }
}

describe('utils/diagram-render-core with curated Pele examples', () => {
  it('covers every diagram type and all Cynefin examples', () => {
    const types = new Set(examples.map(example => example.type))
    const cynefinExamples = examples.filter((example) => {
      return example.type === 'cynefin'
    })

    expect(types.size).toBeGreaterThanOrEqual(32)
    expect(cynefinExamples).toHaveLength(3)
  })

  it.each(examples.map(example => [example.id, example] as const))(
    'renders %s without an error',
    async (_id, example) => {
      const result = await renderExample(example, 700)

      expect(result).not.toHaveProperty('error')
      expect(result).toHaveProperty('svg')
      expect((result as { svg: string }).svg).toContain('<svg')
      expect((result as { svg: string }).svg.length).toBeGreaterThan(200)
    },
  )

  it('renders every example at a phone width', async () => {
    const results = await Promise.all(
      examples.map(example => renderExample(example, 360)),
    )
    const failedIds = results
      .map((result, index) => {
        return 'error' in result ? examples[index]!.id : null
      })
      .filter(Boolean)

    expect(failedIds).toEqual([])
  })
})
