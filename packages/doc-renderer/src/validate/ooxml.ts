import { readOoxmlProvenance, unescapeXml } from '../provenance.ts'
import type { Provenance } from '../provenance.ts'
import type { XlsxSpec } from '../spec/v1.ts'
import { checkFormula } from './formula.ts'
import { inflateEntry } from './inflate.ts'
import { fail } from './result.ts'
import type {
  ValidatedFormat,
  ValidationResult,
  ValidationStats,
} from './result.ts'
import {
  ALLOWED_LINK_PROTOCOLS,
  DOCX_DENIED_FIELDS,
  HYPERLINK_RELATIONSHIP_TYPE_SUFFIX,
  OOXML_DENIED_PART_PATTERNS,
  OOXML_DENIED_RELATIONSHIP_TYPES,
  PPTX_ALLOWED_ACTIONS,
  VALIDATION_LIMITS,
} from './rules.ts'
import { readZipDirectory } from './zip.ts'
import type { ZipEntry } from './zip.ts'

export interface OoxmlValidationOptions {
  spec?: XlsxSpec
}

type OoxmlFormat = Exclude<ValidatedFormat, 'pdf'>

const MAIN_PARTS: Record<OoxmlFormat, { part: string, contentType: string }> = {
  docx: {
    part: 'word/document.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  pptx: {
    part: 'ppt/presentation.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  },
  xlsx: {
    part: 'xl/workbook.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
}

const CONTENT_TYPES_PART = '[Content_Types].xml'
const ROOT_RELATIONSHIPS_PART = '_rels/.rels'
const CUSTOM_PROPERTIES_PART = 'docProps/custom.xml'
const XML_PART_PATTERN = /\.(?:xml|rels|vml)$/i
const MACRO_CONTENT_TYPE_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  code: string
}> = [
  { pattern: /macroEnabled/i, code: 'ooxml_macro' },
  { pattern: /vbaProject/i, code: 'ooxml_macro' },
  { pattern: /activeX/i, code: 'ooxml_active_x' },
  { pattern: /oleObject/i, code: 'ooxml_ole_object' },
]

interface ParsedAttributes {
  [name: string]: string
}

function parseAttributes(source: string): ParsedAttributes {
  const attributes: ParsedAttributes = {}
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

  for (const match of source.matchAll(pattern)) {
    attributes[match[1] as string] = unescapeXml(match[2] ?? match[3] ?? '')
  }

  return attributes
}

function decodeXmlBytes(data: Uint8Array): string {
  if (data[0] === 0xFF && data[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(data)
  }

  if (data[0] === 0xFE && data[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(data)
  }

  return new TextDecoder('utf-8').decode(data)
}

function startsWithAllowedProtocol(target: string): boolean {
  const normalized = target.trim().toLowerCase()

  return ALLOWED_LINK_PROTOCOLS.some((protocol) => {
    return normalized.startsWith(protocol)
  })
}

function columnLetters(index: number): string {
  let letters = ''
  let value = index + 1

  while (value > 0) {
    const remainder = (value - 1) % 26

    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }

  return letters
}

function declaredFormulaCells(spec: XlsxSpec): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>()

  for (const sheet of spec.sheets) {
    const references = new Set<string>()

    sheet.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const isFormula = typeof cell === 'object'
          && cell !== null
          && 'formula' in cell

        if (isFormula) {
          references.add(`${columnLetters(columnIndex)}${rowIndex + 2}`)
        }
      })
    })

    declared.set(sheet.name, references)
  }

  return declared
}

function normalizePartPath(base: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1)
  }

  const segments = base.split('/').slice(0, -1)

  for (const segment of target.split('/')) {
    if (segment === '..') {
      segments.pop()
    } else if (segment !== '.') {
      segments.push(segment)
    }
  }

  return segments.join('/')
}

function checkRelationships(source: string): ValidationResult | null {
  for (const match of source.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attributes = parseAttributes(match[1] || '')
    const type = attributes.Type || ''
    const target = attributes.Target || ''
    const isExternal = attributes.TargetMode === 'External'

    for (const denied of OOXML_DENIED_RELATIONSHIP_TYPES) {
      if (denied.pattern.test(type)) {
        return fail(denied.code, `Relationship type ${type.slice(-60)} is not allowed`)
      }
    }

    if (isExternal) {
      const isHyperlink = type.endsWith(HYPERLINK_RELATIONSHIP_TYPE_SUFFIX)

      if (!isHyperlink || !startsWithAllowedProtocol(target)) {
        return fail(
          'ooxml_external_relationship',
          `External relationship to ${target.slice(0, 80)} is not allowed`,
        )
      }
    }
  }

  return null
}

function checkContentTypes(
  source: string,
  format: OoxmlFormat,
): ValidationResult | null {
  const main = MAIN_PARTS[format]
  const overrides = new Map<string, string>()

  for (const match of source.matchAll(/<(Default|Override)\b([^>]*?)\/?>/g)) {
    const attributes = parseAttributes(match[2] || '')
    const contentType = attributes.ContentType || ''

    for (const denied of MACRO_CONTENT_TYPE_PATTERNS) {
      if (denied.pattern.test(contentType)) {
        return fail(denied.code, `Content type ${contentType.slice(0, 100)} is not allowed`)
      }
    }

    if (match[1] === 'Override') {
      overrides.set((attributes.PartName || '').replace(/^\//, ''), contentType)
    }
  }

  const declared = overrides.get(main.part)

  if (declared !== main.contentType) {
    return fail(
      'ooxml_format_mismatch',
      `Main part ${main.part} has content type ${(declared || 'none').slice(0, 100)}, expected the ${format} main type`,
    )
  }

  return null
}

function checkDocxFields(source: string): ValidationResult | null {
  const fields: string[] = []
  let buffer = ''
  let isCollecting = false
  const pattern
    = /<w:fldChar\b([^>]*?)\/?>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:fldSimple\b([^>]*?)\/?>/g

  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) {
      const type = parseAttributes(match[1])['w:fldCharType']

      if (type === 'begin') {
        if (buffer) {
          fields.push(buffer)
        }

        buffer = ''
        isCollecting = true
      } else if (isCollecting) {
        if (buffer) {
          fields.push(buffer)
        }

        buffer = ''
        isCollecting = false
      }
    } else if (match[2] !== undefined) {
      buffer += unescapeXml(match[2])
      isCollecting = true
    } else if (match[3] !== undefined) {
      fields.push(parseAttributes(match[3])['w:instr'] || '')
    }
  }

  if (isCollecting && buffer) {
    fields.push(buffer)
  }

  for (const instruction of fields) {
    const name = /^\s*"?([A-Za-z]+)/.exec(instruction)?.[1]?.toUpperCase()

    if (name && DOCX_DENIED_FIELDS.includes(name)) {
      return fail('docx_field_instruction', `Field ${name} is not allowed`)
    }

    if (name === 'HYPERLINK') {
      const target = /"([^"]*)"/.exec(instruction)?.[1]
      const isAnchorOnly = /\\l\s/i.test(instruction) && !target

      if (!isAnchorOnly && (!target || !startsWithAllowedProtocol(target))) {
        return fail(
          'docx_field_instruction',
          'HYPERLINK field target is not allowed',
        )
      }
    }
  }

  return null
}

function checkPptxActions(source: string): ValidationResult | null {
  for (const match of source.matchAll(/ppaction:\/\/[^"'<>\s&]*/gi)) {
    const action = match[0].toLowerCase()
    const isAllowed = PPTX_ALLOWED_ACTIONS.some((allowed) => {
      return action === allowed || action.startsWith(`${allowed}?`)
    })

    if (!isAllowed) {
      return fail('pptx_action', `Action ${action.slice(0, 60)} is not allowed`)
    }
  }

  return null
}

function checkFormulaText(raw: string): ValidationResult | null {
  const checked = checkFormula(unescapeXml(raw))

  return checked.ok ? null : fail(checked.code, checked.detail)
}

interface SheetCheckContext {
  sheetName: string | null
  declared: Map<string, Set<string>> | null
}

function checkSheet(
  source: string,
  context: SheetCheckContext,
  stats: ValidationStats,
): ValidationResult | null {
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

  for (const match of source.matchAll(cellPattern)) {
    stats.cells = (stats.cells || 0) + 1

    const body = match[2]

    if (!body || !body.includes('<f')) {
      continue
    }

    const formulaMatch = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body)

    if (!formulaMatch) {
      continue
    }

    const formulaAttributes = parseAttributes(formulaMatch[1] || '')

    if (
      formulaAttributes.t !== undefined
      && formulaAttributes.t !== 'normal'
      && formulaAttributes.t !== 'shared'
      && formulaAttributes.t !== 'array'
    ) {
      return fail('xlsx_formula_type', `Formula type ${formulaAttributes.t.slice(0, 20)} is not allowed`)
    }

    if (formulaMatch[2]) {
      const failure = checkFormulaText(formulaMatch[2])

      if (failure) {
        return failure
      }
    }

    if (context.declared) {
      const reference = parseAttributes(match[1] || '').r || ''
      const references = context.sheetName
        ? context.declared.get(context.sheetName)
        : undefined

      if (!references?.has(reference)) {
        return fail(
          'formula_undeclared',
          `Cell ${reference.slice(0, 12)} has a formula the spec does not declare`,
        )
      }
    }
  }

  for (const match of source.matchAll(/<(formula1|formula2|formula)>([\s\S]*?)<\/\1>/g)) {
    const failure = checkFormulaText(match[2] || '')

    if (failure) {
      return failure
    }
  }

  return null
}

function findEntry(
  entries: ZipEntry[],
  name: string,
): ZipEntry | undefined {
  const key = name.toLowerCase()

  return entries.find(entry => entry.name.toLowerCase() === key)
}

function readText(
  archive: Uint8Array,
  entry: ZipEntry,
): { ok: true, text: string } | ValidationResult {
  const inflated = inflateEntry(archive, entry)

  if (!inflated.ok) {
    return fail(inflated.code, inflated.detail)
  }

  return { ok: true, text: decodeXmlBytes(inflated.data) }
}

function isFailure(value: unknown): value is ValidationResult {
  return typeof value === 'object'
    && value !== null
    && 'ok' in value
    && (value as { ok: boolean }).ok === false
}

function mapSheetNames(
  workbook: string,
  workbookRelationships: string,
): Map<string, string> {
  const targets = new Map<string, string>()

  for (const match of workbookRelationships.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attributes = parseAttributes(match[1] || '')

    if (attributes.Id && attributes.Target) {
      targets.set(
        attributes.Id,
        normalizePartPath('xl/workbook.xml', attributes.Target),
      )
    }
  }

  const names = new Map<string, string>()

  for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attributes = parseAttributes(match[1] || '')
    const target = targets.get(attributes['r:id'] || '')

    if (target && attributes.name) {
      names.set(target.toLowerCase(), attributes.name)
    }
  }

  return names
}

export function validateOoxml(
  format: OoxmlFormat,
  bytes: Uint8Array,
  options: OoxmlValidationOptions = {},
): ValidationResult {
  const zip = readZipDirectory(bytes)

  if (!zip.ok) {
    return fail(zip.code, zip.detail)
  }

  const { entries } = zip.directory
  const stats: ValidationStats = {
    bytes: bytes.length,
    entries: entries.length,
  }

  for (const entry of entries) {
    if (entry.name.endsWith('/')) {
      continue
    }

    for (const denied of OOXML_DENIED_PART_PATTERNS) {
      if (denied.pattern.test(entry.name)) {
        return fail(denied.code, `Part ${entry.name.slice(0, 80)} is not allowed`)
      }
    }
  }

  for (const required of [CONTENT_TYPES_PART, ROOT_RELATIONSHIPS_PART]) {
    if (!findEntry(entries, required)) {
      return fail('ooxml_missing_part', `Missing ${required}`)
    }
  }

  const contentTypesEntry = findEntry(entries, CONTENT_TYPES_PART) as ZipEntry
  const contentTypes = readText(bytes, contentTypesEntry)

  if (isFailure(contentTypes)) {
    return contentTypes
  }

  if (/<!DOCTYPE|<!ENTITY/i.test(contentTypes.text)) {
    return fail('xml_doctype', `${CONTENT_TYPES_PART} declares a DOCTYPE or ENTITY`)
  }

  const typeFailure = checkContentTypes(contentTypes.text, format)

  if (typeFailure) {
    return typeFailure
  }

  const main = MAIN_PARTS[format]

  if (!findEntry(entries, main.part)) {
    return fail('ooxml_format_mismatch', `Missing main part ${main.part}`)
  }

  for (const [otherFormat, otherMain] of Object.entries(MAIN_PARTS)) {
    if (otherFormat !== format && findEntry(entries, otherMain.part)) {
      return fail(
        'ooxml_format_mismatch',
        `Package also contains ${otherMain.part}`,
      )
    }
  }

  let sheetPartNames = new Map<string, string>()
  const declared = format === 'xlsx' && options.spec
    ? declaredFormulaCells(options.spec)
    : null

  if (format === 'xlsx') {
    const workbookEntry = findEntry(entries, 'xl/workbook.xml') as ZipEntry
    const relsEntry = findEntry(entries, 'xl/_rels/workbook.xml.rels')
    const workbook = readText(bytes, workbookEntry)

    if (isFailure(workbook)) {
      return workbook
    }

    const workbookRelationships = relsEntry ? readText(bytes, relsEntry) : null

    if (workbookRelationships && isFailure(workbookRelationships)) {
      return workbookRelationships
    }

    sheetPartNames = mapSheetNames(
      workbook.text,
      workbookRelationships?.text || '',
    )
    stats.sheets = sheetPartNames.size
  }

  let provenance: Provenance = 'missing'
  let slides = 0

  for (const entry of entries) {
    if (entry.name.endsWith('/')) {
      continue
    }

    const lowerName = entry.name.toLowerCase()

    if (lowerName === CONTENT_TYPES_PART.toLowerCase()) {
      continue
    }

    if (!XML_PART_PATTERN.test(entry.name)) {
      continue
    }

    const content = readText(bytes, entry)

    if (isFailure(content)) {
      return content
    }

    const { text } = content

    if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
      return fail('xml_doctype', `${entry.name.slice(0, 80)} declares a DOCTYPE or ENTITY`)
    }

    if (lowerName.endsWith('.rels')) {
      const failure = checkRelationships(text)
        ?? (format === 'pptx' ? checkPptxActions(text) : null)

      if (failure) {
        return failure
      }

      continue
    }

    if (lowerName === CUSTOM_PROPERTIES_PART.toLowerCase()) {
      if (text.length <= VALIDATION_LIMITS.customPropertiesBytesMax) {
        provenance = readOoxmlProvenance(text)
      }

      continue
    }

    if (format === 'docx' && lowerName.startsWith('word/')) {
      const failure = checkDocxFields(text)

      if (failure) {
        return failure
      }
    }

    if (format === 'pptx' && lowerName.startsWith('ppt/')) {
      const failure = checkPptxActions(text)

      if (failure) {
        return failure
      }

      if (/^ppt\/slides\/slide\d+\.xml$/.test(lowerName)) {
        slides += 1
      }
    }

    if (format === 'xlsx') {
      if (lowerName === 'xl/workbook.xml') {
        for (const match of text.matchAll(/<definedName\b[^>]*>([\s\S]*?)<\/definedName>/g)) {
          const failure = checkFormulaText(match[1] || '')

          if (failure) {
            return failure
          }
        }
      }

      if (/^xl\/worksheets\/[^/]+\.xml$/.test(lowerName)) {
        const failure = checkSheet(
          text,
          { sheetName: sheetPartNames.get(lowerName) || null, declared },
          stats,
        )

        if (failure) {
          return failure
        }
      }
    }
  }

  if (format === 'pptx') {
    stats.slides = slides
  }

  return { ok: true, stats, provenance }
}
