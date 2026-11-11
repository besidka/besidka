import { strToU8, unzipSync, zlibSync } from 'fflate'
import { extractText, getDocumentProxy, getMeta } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import { render } from '@besidka/doc-renderer/render'
import { validate } from '@besidka/doc-renderer/validate'
import {
  loadFonts,
  loadReferenceAssets,
} from '~~/tests/setup/helpers/documents'

const decoder = new TextDecoder()

function parseSpec(input: unknown): DocumentSpec {
  const parsed = parseDocumentSpec(input)

  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }

  return parsed.spec
}

function renderSpec(spec: DocumentSpec) {
  return render(spec, loadReferenceAssets(), { fonts: loadFonts() })
}

function pdfSpec(title: string, blocks: unknown[]): DocumentSpec {
  return parseSpec({
    specVersion: 1,
    format: 'pdf',
    title,
    pageSize: 'A4',
    blocks,
  })
}

describe('render hardening', () => {
  it('keeps special replacement patterns in a title literal', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'docx',
      title: 'Revenue ($\'000, $& and $`)',
      blocks: [{ type: 'paragraph', runs: [{ text: 'x' }] }],
    })
    const result = await renderSpec(spec)
    const core = decoder.decode(
      unzipSync(result.bytes)['docProps/core.xml'],
    )

    expect(core).toContain(
      '<dc:title>Revenue ($&apos;000, $&amp; and $`)</dc:title>',
    )
    expect(core.match(/<dc:title>/g)).toHaveLength(1)
  })

  it('writes XMP as UTF-8 and keeps non-ASCII titles intact', async () => {
    const result = await renderSpec(pdfSpec('Звіт Київ', [
      { type: 'paragraph', runs: [{ text: 'x' }] },
    ]))
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const meta = await getMeta(document)

    expect(decoder.decode(result.bytes)).toContain('Звіт Київ')
    expect(meta.metadata?.get('dc:title')).toBe('Звіт Київ')
  })

  it('writes link actions as hex strings that cannot inject syntax', async () => {
    const hostile = 'https://x.example/)%20/Next%20<<%20/S%20/Named%20(('
    const result = await renderSpec(pdfSpec('Links', [{
      type: 'paragraph',
      runs: [
        { text: 'a', link: { href: hostile.replace('<<', '%3C%3C') } },
        { text: 'b', link: { href: 'https://x.example/Київ' } },
      ],
    }]))
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const page = await document.getPage(1)
    const urls = (await page.getAnnotations()).map(item => item.url)

    expect(validate('pdf', result.bytes).ok).toBe(true)
    expect(urls.some(url => url?.includes('%D0%9A'))).toBe(true)
    expect(decoder.decode(result.bytes)).not.toContain('/Named')
  })

  it('keeps no-break spaces as spaces in PDF text', async () => {
    const result = await renderSpec(pdfSpec('Numbers', [{
      type: 'paragraph',
      runs: [{ text: '10 000 and 5 000' }],
    }]))
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const { text } = await extractText(document, { mergePages: true })

    expect(text.replace(/\s+/g, ' ')).toContain('10 000')
  })

  it('rejects a PNG that inflates far beyond its header', async () => {
    const png = loadReferenceAssets().get('chart-revenue.png')
      ?.bytes as Uint8Array
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const pixels = view.getUint32(16) * view.getUint32(20)
    const chunk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length)

      new DataView(out.buffer).setUint32(0, data.length)
      out.set(strToU8(type), 4)
      out.set(data, 8)

      return out
    }
    const bomb = zlibSync(new Uint8Array(pixels * 4 * 200), { level: 9 })
    const parts = [
      png.slice(0, 8 + 25),
      chunk('IDAT', bomb),
      chunk('IEND', new Uint8Array(0)),
    ]
    const forged = new Uint8Array(
      parts.reduce((total, part) => total + part.length, 0),
    )
    let offset = 0

    for (const part of parts) {
      forged.set(part, offset)
      offset += part.length
    }

    const spec = parseSpec({
      specVersion: 1,
      format: 'docx',
      title: 'Bomb',
      blocks: [{ type: 'image', fileId: 'bomb', alt: 'a', widthPercent: 50 }],
    })

    await expect(
      render(spec, new Map([['bomb', { bytes: forged, mediaType: 'image/png' }]])),
    ).rejects.toMatchObject({ code: 'image_too_large' })
  })
})

describe('spec hardening', () => {
  const deckWithTitle = (title: string) => ({
    specVersion: 1,
    format: 'pptx',
    title: 'T',
    aspect: '16:9',
    slides: [{ layout: 'section', title }],
  })
  const bookWithDate = (date: string) => ({
    specVersion: 1,
    format: 'xlsx',
    title: 'T',
    sheets: [{
      name: 'S',
      columns: [{ header: 'D', type: 'date' }],
      rows: [[{ date }]],
    }],
  })

  it('rejects hrefs with whitespace, backslashes and angle brackets', () => {
    for (const href of [
      'https://x.example/a b',
      'https://x.example/\\',
      'https://x.example/<',
    ]) {
      const result = parseDocumentSpec({
        specVersion: 1,
        format: 'docx',
        title: 'T',
        blocks: [{
          type: 'paragraph',
          runs: [{ text: 'a', link: { href } }],
        }],
      })

      expect(result.ok, href).toBe(false)
    }
  })

  it('rejects control characters but keeps line breaks', () => {
    expect(parseDocumentSpec(deckWithTitle('ok\u001b')).ok).toBe(false)
    expect(parseDocumentSpec(deckWithTitle('ok\u0000')).ok).toBe(false)
    expect(parseDocumentSpec(deckWithTitle('line\nbreak')).ok).toBe(true)
  })

  it('rejects impossible date times', () => {
    expect(parseDocumentSpec(bookWithDate('2026-11-08T99:99')).ok).toBe(false)
    expect(parseDocumentSpec(bookWithDate('2026-11-08T10:30:00Z')).ok)
      .toBe(true)
  })

  it('counts newlines in the page estimate', () => {
    const newlines = (count: number) => ({
      type: 'paragraph',
      runs: [{ text: '\n'.repeat(count) }],
    })
    const document = (blocks: unknown[]) => ({
      specVersion: 1,
      format: 'docx',
      title: 'T',
      blocks,
    })

    expect(parseDocumentSpec(document([newlines(3999)])).ok).toBe(true)
    expect(
      parseDocumentSpec(
        document(Array.from({ length: 60 }, () => newlines(3999))),
      ).ok,
    ).toBe(false)
  })
})
