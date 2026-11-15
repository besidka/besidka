import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  ImageAsset,
  RenderAssets,
  RenderFonts,
} from '@besidka/doc-renderer/render'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..')
const REFERENCE_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  'tests/fixtures/documents/reference',
)
const FONT_DIRECTORY = resolve(REPOSITORY_ROOT, 'packages/doc-renderer/fonts')

export type ReferenceSpecName
  = | 'report'
    | 'report-pdf'
    | 'deck'
    | 'workbook'
    | 'showcase'

export function loadReferenceSpec(name: ReferenceSpecName): unknown {
  return JSON.parse(
    readFileSync(resolve(REFERENCE_DIRECTORY, `${name}.json`), 'utf8'),
  )
}

export function loadWorstCaseRules(): unknown {
  return JSON.parse(
    readFileSync(resolve(REFERENCE_DIRECTORY, 'worst-case.json'), 'utf8'),
  )
}

function loadImage(name: string): ImageAsset {
  return {
    bytes: new Uint8Array(readFileSync(resolve(REFERENCE_DIRECTORY, name))),
    mediaType: 'image/png',
  }
}

export function loadReferenceAssets(): RenderAssets {
  return new Map([
    ['chart-revenue.png', loadImage('chart-revenue.png')],
    ['chart-regions.png', loadImage('chart-regions.png')],
  ])
}

export function loadFonts(): RenderFonts {
  const read = (name: string) => {
    return new Uint8Array(readFileSync(resolve(FONT_DIRECTORY, name)))
  }

  return {
    regular: read('NotoSans-Regular.ttf'),
    bold: read('NotoSans-Bold.ttf'),
    italic: read('NotoSans-Italic.ttf'),
  }
}
