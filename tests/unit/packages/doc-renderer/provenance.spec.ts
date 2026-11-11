import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { escapeCsvCell, toCsvRow } from '@besidka/doc-renderer/csv'
import {
  DIGITAL_SOURCE_TYPE,
  buildOoxmlCustomProps,
  buildPdfXmp,
  buildProvenanceProperties,
  readOoxmlProvenance,
  readXmpProvenance,
  sanitizeModelId,
} from '@besidka/doc-renderer/provenance'
import { stampDocument, stampOoxml } from '@besidka/doc-renderer/stamp'
import { validate } from '@besidka/doc-renderer/validate'
import {
  buildPackage,
  buildPdf,
  pdfWithMetadata,
} from '../../../fixtures/documents/malicious/builders'

const decoder = new TextDecoder()

function partText(bytes: Uint8Array, name: string): string {
  const part = unzipSync(bytes)[name]

  if (!part) {
    throw new Error(`Missing ${name}`)
  }

  return decoder.decode(part)
}

describe('provenance constants', () => {
  it('mirrors the IPTC vocabulary of the image marking', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../../server/utils/ai/image-provenance.ts'),
      'utf8',
    )

    expect(source).toContain(DIGITAL_SOURCE_TYPE.trainedAlgorithmicMedia)
    expect(source).toContain('Iptc4xmpExt:AISystemUsed')
    expect(source).toContain('http://iptc.org/std/Iptc4xmpExt/2008-02-29/')
    expect(
      source.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' '),
    ).toContain(DIGITAL_SOURCE_TYPE.compositeWithTrainedAlgorithmicMedia)
    expect(DIGITAL_SOURCE_TYPE.trainedAlgorithmicMedia)
      .toBe('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia')
  })
})

describe('buildOoxmlCustomProps', () => {
  it('writes the IPTC source type, the model and the channel only', () => {
    const xml = buildOoxmlCustomProps({ model: 'claude-x', createdVia: 'chat' })

    expect(xml).toContain('name="Iptc4xmpExt:DigitalSourceType"')
    expect(xml).toContain(DIGITAL_SOURCE_TYPE.trainedAlgorithmicMedia)
    expect(xml).toContain('name="Iptc4xmpExt:AISystemUsed"')
    expect(xml).toContain('<vt:lpwstr>claude-x</vt:lpwstr>')
    expect(xml).toContain('name="besidka:generator"')
    expect(xml).toContain('name="besidka:createdVia"')
    expect(xml).toContain('<vt:lpwstr>chat</vt:lpwstr>')
    expect(readOoxmlProvenance(xml)).toBe('ai')
  })

  it('omits the AI source type for caller-supplied content', () => {
    const xml = buildOoxmlCustomProps({ createdVia: 'mcp', aiGenerated: false })

    expect(xml).not.toContain('DigitalSourceType')
    expect(xml).not.toContain('AISystemUsed')
    expect(readOoxmlProvenance(xml)).toBe('channel-only')
  })

  it('carries no prompt, user or chat identifiers', () => {
    const properties = buildProvenanceProperties({
      model: 'm',
      createdVia: 'research',
    })

    expect(properties.map(property => property.name).sort()).toEqual([
      'Iptc4xmpExt:AISystemUsed',
      'Iptc4xmpExt:DigitalSourceType',
      'besidka:createdVia',
      'besidka:generator',
    ])
  })

  it('escapes and limits the model id', () => {
    const xml = buildOoxmlCustomProps({
      model: `<m & "x">${'y'.repeat(300)}\u0000`,
      createdVia: 'chat',
    })

    expect(xml).toContain('&lt;m &amp; &quot;x&quot;&gt;')
    expect(sanitizeModelId('a'.repeat(300))).toHaveLength(200)
    expect(sanitizeModelId('a\u0001b\u007Fc')).toBe('a b c')
  })

  it('rejects a malformed channel name', () => {
    expect(() => buildOoxmlCustomProps({
      createdVia: 'chat"><x' as 'chat',
    })).toThrow(RangeError)
  })

  it('reads missing when nothing identifies the file', () => {
    expect(readOoxmlProvenance('<Properties/>')).toBe('missing')
    expect(readOoxmlProvenance('')).toBe('missing')
  })

  it('does not count a non-AI source type', () => {
    const xml = buildOoxmlCustomProps({ createdVia: 'chat' })
      .replace('trainedAlgorithmicMedia', 'digitalCapture')

    expect(readOoxmlProvenance(xml)).toBe('channel-only')
  })
})

describe('buildPdfXmp', () => {
  it('writes IPTC, Besidka and Dublin Core blocks', () => {
    const xmp = buildPdfXmp({
      model: 'gpt-x',
      createdVia: 'chat',
      title: 'Звіт & Report',
      language: 'uk-UA',
    })

    expect(xmp).toContain('Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/')
    expect(xmp).toContain('Iptc4xmpExt:AISystemUsed="gpt-x"')
    expect(xmp).toContain('besidka:createdVia="chat"')
    expect(xmp).toContain('Звіт &amp; Report')
    expect(xmp).toContain('<dc:language><rdf:Bag><rdf:li>uk-UA</rdf:li>')
    expect(readXmpProvenance(xmp)).toBe('ai')
  })

  it('reads channel-only and missing', () => {
    expect(readXmpProvenance(buildPdfXmp({ createdVia: 'mcp', aiGenerated: false })))
      .toBe('channel-only')
    expect(readXmpProvenance('<x:xmpmeta/>')).toBe('missing')
  })

  it('reads an element-form DigitalSourceType', () => {
    const xmp = '<Iptc4xmpExt:DigitalSourceType>'
      + `${DIGITAL_SOURCE_TYPE.compositeWithTrainedAlgorithmicMedia}`
      + '</Iptc4xmpExt:DigitalSourceType>'

    expect(readXmpProvenance(xmp)).toBe('ai')
  })
})

describe('stampOoxml', () => {
  it('adds custom properties, the override and the relationship', () => {
    const stamped = stampOoxml(buildPackage('docx'), {
      createdVia: 'code-execution',
      model: 'o-x',
    })

    expect(stamped.ok).toBe(true)

    if (!stamped.ok) {
      return
    }

    expect(partText(stamped.bytes, 'docProps/custom.xml')).toContain('o-x')
    expect(partText(stamped.bytes, '[Content_Types].xml'))
      .toContain('/docProps/custom.xml')
    expect(partText(stamped.bytes, '_rels/.rels')).toContain('custom-properties')

    const result = validate('docx', stamped.bytes)

    expect(result.ok && result.provenance).toBe('ai')
  })

  it('is byte-stable: pinned dates and fixed ZIP entry times', () => {
    const options = {
      createdVia: 'chat' as const,
      title: 'T',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
    }
    const first = stampOoxml(buildPackage('docx'), options)
    const second = stampOoxml(buildPackage('docx'), options)

    expect(first.ok && second.ok).toBe(true)

    if (first.ok && second.ok) {
      expect(first.bytes).toEqual(second.bytes)

      const core = partText(first.bytes, 'docProps/core.xml')

      expect(core).toContain('<dc:title>T</dc:title>')
      expect(core).toContain('<dc:language>en</dc:language>')
      expect(core).toContain(
        '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>',
      )
      expect(core).toContain(
        '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>',
      )
    }
  })

  it('rewrites existing core.xml dates and keeps other properties', () => {
    const core = '<?xml version="1.0"?><cp:coreProperties'
      + ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
      + ' xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:creator>Someone</dc:creator>'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">2020-05-05T05:05:05Z</dcterms:created>'
      + '</cp:coreProperties>'
    const stamped = stampOoxml(
      buildPackage('docx', { files: { 'docProps/core.xml': core } }),
      { createdVia: 'chat', createdAt: '2026-01-01T00:00:00Z' },
    )

    expect(stamped.ok).toBe(true)

    if (stamped.ok) {
      const text = partText(stamped.bytes, 'docProps/core.xml')

      expect(text).toContain('<dc:creator>Someone</dc:creator>')
      expect(text).not.toContain('2020-05-05')
      expect(text).toContain('2026-01-01T00:00:00Z')
    }
  })

  it('leaves dates alone when no pin is requested', () => {
    const core = '<cp:coreProperties xmlns:cp="x" xmlns:dcterms="y" xmlns:xsi="z">'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">2020-05-05T05:05:05Z</dcterms:created>'
      + '</cp:coreProperties>'
    const stamped = stampOoxml(
      buildPackage('docx', { files: { 'docProps/core.xml': core } }),
      { createdVia: 'chat' },
    )

    expect(stamped.ok).toBe(true)

    if (stamped.ok) {
      expect(partText(stamped.bytes, 'docProps/core.xml')).toBe(core)
    }
  })

  it('replaces its own properties and keeps foreign custom properties', () => {
    const custom = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
      + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
      + '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>Acme</vt:lpwstr></property>'
      + '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="besidka:createdVia"><vt:lpwstr>old</vt:lpwstr></property>'
      + '</Properties>'
    const stamped = stampOoxml(
      buildPackage('docx', { files: { 'docProps/custom.xml': custom } }),
      { createdVia: 'chat', model: 'm' },
    )

    expect(stamped.ok).toBe(true)

    if (stamped.ok) {
      const text = partText(stamped.bytes, 'docProps/custom.xml')

      expect(text).toContain('Acme')
      expect(text).not.toContain('>old<')
      expect(text.match(/besidka:createdVia/g)).toHaveLength(1)
      expect(text.match(/pid="(\d+)"/g)?.length).toBe(5)
    }
  })

  it('refuses an invalid date and unsafe archives', () => {
    const invalidDate = stampOoxml(buildPackage('docx'), {
      createdVia: 'chat',
      createdAt: 'yesterday',
    })

    expect(invalidDate.ok).toBe(false)
    expect(stampOoxml(new Uint8Array([1, 2, 3, 4]), { createdVia: 'chat' }).ok)
      .toBe(false)
  })
})

describe('stampDocument', () => {
  it('stamps a provider-made OOXML file that carries no marking', async () => {
    const provider = buildPackage('xlsx')

    expect(validate('xlsx', provider).ok && validate('xlsx', provider)).toMatchObject({
      provenance: 'missing',
    })

    const stamped = await stampDocument('xlsx', provider, {
      createdVia: 'code-execution',
      model: 'claude-x',
    })

    expect(stamped.ok).toBe(true)

    if (stamped.ok) {
      expect(stamped.stamped).toBe(true)
      expect(stamped.provenance).toBe('ai')
      expect(validate('xlsx', stamped.bytes)).toMatchObject({ provenance: 'ai' })
    }
  })

  it('stamps a provider-made PDF and keeps it valid', async () => {
    const stamped = await stampDocument('pdf', buildPdf(), {
      createdVia: 'code-execution',
      model: 'gpt-x',
    })

    expect(stamped.ok).toBe(true)

    if (stamped.ok) {
      expect(stamped.provenance).toBe('ai')
      expect(validate('pdf', stamped.bytes)).toMatchObject({
        ok: true,
        provenance: 'ai',
      })
    }
  })

  it('returns an already marked file byte-identical', async () => {
    const marked = pdfWithMetadata(buildPdfXmp({ createdVia: 'chat', model: 'm' }))
    const result = await stampDocument('pdf', marked, { createdVia: 'chat' })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.stamped).toBe(false)
      expect(result.bytes).toBe(marked)
    }
  })

  it('refuses files that fail validation', async () => {
    const dangerous = buildPackage('docx', { files: { 'word/vbaProject.bin': 'x' } })
    const result = await stampDocument('docx', dangerous, { createdVia: 'chat' })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.code).toBe('ooxml_macro')
    }
  })

  it('records channel-only for caller-supplied content', async () => {
    const result = await stampDocument('docx', buildPackage('docx'), {
      createdVia: 'mcp',
      aiGenerated: false,
    })

    expect(result.ok && result.provenance).toBe('channel-only')
  })
})

describe('escapeCsvCell', () => {
  it.each([
    '=1+1',
    '+1',
    '-1+2',
    '@SUM(A1)',
    '\tcmd',
    '\rcmd',
    '\ncmd',
    '＝1+1',
    '＋1',
    '－1',
    '＠SUM(A1)',
  ])('neutralises %j with a tab inside a quoted field', (value) => {
    expect(escapeCsvCell(value)).toBe(`"\t${value}"`)
  })

  it('offers the apostrophe form on request', () => {
    expect(escapeCsvCell('=1+1', { style: 'apostrophe' })).toBe('"\'=1+1"')
  })

  it('quotes fields with separators and doubles quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"')
  })

  it('leaves plain text, numbers and empty cells alone', () => {
    expect(escapeCsvCell('plain')).toBe('plain')
    expect(escapeCsvCell('a-b')).toBe('a-b')
    expect(escapeCsvCell(-5)).toBe('-5')
    expect(escapeCsvCell(true)).toBe('true')
    expect(escapeCsvCell(null)).toBe('')
    expect(escapeCsvCell(undefined)).toBe('')
  })

  it('builds rows', () => {
    expect(toCsvRow(['a', '=x', 1])).toBe('a,"\t=x",1')
  })
})
