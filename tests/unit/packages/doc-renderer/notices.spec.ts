import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectNotices,
  findLegalComments,
  inputsWithLegalComments,
} from '../../../../scripts/third-party-notices.mjs'

const NOTICES_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/doc-renderer/THIRD_PARTY_NOTICES.txt',
)
const EXPECTED_PACKAGES = [
  'docx',
  'pptxgenjs',
  'jszip',
  'write-excel-file',
  'pdf-lib',
  '@pdf-lib/fontkit',
  '@pdf-lib/upng',
  '@pdf-lib/standard-fonts',
  'pako',
  'tslib',
  'fflate',
  'zod',
]

describe('THIRD_PARTY_NOTICES', () => {
  it('names every package in the client and Worker bundle graphs', async () => {
    const { packages, text, graphs } = await collectNotices()
    const names = packages.map((entry: { name: string }) => entry.name)

    for (const expected of EXPECTED_PACKAGES) {
      expect(names, expected).toContain(expected)
      expect(text).toContain(`${expected} `)
    }

    for (const entry of packages as { name: string, text: string | null }[]) {
      expect(text, entry.name).toContain(entry.name)
    }

    expect(Object.keys(graphs).sort()).toEqual(['client', 'worker'])

    for (const entry of packages as { graphs: Set<string> }[]) {
      expect([...entry.graphs].sort()).toEqual(['client', 'worker'])
    }
  }, 60000)

  it('lists code that a package-graph walk cannot see', async () => {
    const { text } = await collectNotices()

    expect(text).toContain('Brotli decoder inlined in @pdf-lib/fontkit')
    expect(text).toContain('Copyright 2013 Google Inc.')
    expect(text).toContain('Apache License')
    expect(text).toContain('base64-arraybuffer')
    expect(text).toContain('Niklas von Hertzen')
    expect(text).toContain('Joyent')
    expect(text).toContain('nanoid inlined in docx')
    expect(text).toContain('fflate inlined in docx')
    expect(text).toContain('Devon Govett')
    expect(text).toContain('under the MIT licence')
    expect(text).toContain('SIL OPEN FONT LICENSE')
    expect(text).toContain('Noto Project Authors')
  }, 60000)

  it('keeps /*! legal comments through the minified build', async () => {
    const { graphs, legalComments } = await collectNotices()

    expect(legalComments.length).toBeGreaterThan(0)

    for (const graph of Object.values(graphs) as {
      code: string
      inputs: string[]
    }[]) {
      const banners = inputsWithLegalComments(graph.inputs)
        .filter(entry => entry.input.includes('jszip'))
        .flatMap(entry => entry.comments)

      expect(banners.length).toBeGreaterThan(0)
      expect(graph.code).toContain('JSZip v3.10.2')
      expect(graph.code).toContain('Bundled license information')
      expect(findLegalComments(graph.code).length).toBeGreaterThan(0)
    }
  }, 60000)

  it('matches the committed file, so a dependency bump regenerates it', async () => {
    const { text } = await collectNotices()

    expect(readFileSync(NOTICES_PATH, 'utf8')).toBe(text)
  }, 60000)
})
