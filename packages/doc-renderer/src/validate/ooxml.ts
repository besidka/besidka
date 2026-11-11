import { readOoxmlProvenance } from '../provenance.ts'
import type { Provenance } from '../provenance.ts'
import type { XlsxSpec } from '../spec/v1.ts'
import { checkFormula } from './formula.ts'
import { inflateEntry } from './inflate.ts'
import { fail } from './result.ts'
import type {
  ValidatedFormat,
  ValidationFailure,
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
import { XmlError, decodeXmlBytes, parseXml } from './xml.ts'
import type { XmlEvent } from './xml.ts'
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

const CONTENT_TYPES_PART = '[content_types].xml'
const ROOT_RELATIONSHIPS_PART = '_rels/.rels'
const CUSTOM_PROPERTIES_PART = 'docprops/custom.xml'
const CUSTOM_RELATIONSHIP_SUFFIX = '/custom-properties'
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
const PPACTION_PATTERN = /ppaction:\/\/[^\s"'<>&]*/gi
const FORMULA_ELEMENTS = new Set([
  'formula',
  'formula1',
  'formula2',
  'definedName',
  'calculatedColumnFormula',
])
const ALLOWED_FORMULA_TYPES = ['normal', 'shared', 'array']

interface PackageState {
  format: OoxmlFormat
  stats: ValidationStats
  declared: Map<string, Set<string>> | null
  sheetPartNames: Map<string, string>
  contentTypeOverrides: Map<string, string>
  customPropertiesLinked: boolean
  customProvenance: Provenance
  slides: number
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
    return target.slice(1).toLowerCase()
  }

  const segments = base.split('/').slice(0, -1)

  for (const segment of target.split('/')) {
    if (segment === '..') {
      segments.pop()
    } else if (segment !== '.') {
      segments.push(segment)
    }
  }

  return segments.join('/').toLowerCase()
}

function checkPptxActionText(text: string): ValidationFailure | null {
  for (const match of text.matchAll(PPACTION_PATTERN)) {
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

function checkRelationship(
  partName: string,
  attributes: Record<string, string>,
  state: PackageState,
): ValidationFailure | null {
  const type = attributes.Type ?? ''
  const target = attributes.Target ?? ''
  const isExternal = attributes.TargetMode === 'External'

  for (const denied of OOXML_DENIED_RELATIONSHIP_TYPES) {
    if (denied.pattern.test(type)) {
      return fail(
        denied.code,
        `Relationship type ${type.slice(-60)} is not allowed`,
      )
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

  const isCustomLink = partName === ROOT_RELATIONSHIPS_PART
    && type.endsWith(CUSTOM_RELATIONSHIP_SUFFIX)
    && normalizePartPath('x/y', `/${target.replace(/^\//, '')}`)
    === CUSTOM_PROPERTIES_PART

  if (isCustomLink) {
    state.customPropertiesLinked = true
  }

  return state.format === 'pptx' ? checkPptxActionText(target) : null
}

function checkFieldInstruction(instruction: string): ValidationFailure | null {
  const name = /^\s*"?([A-Za-z]+)/.exec(instruction)?.[1]?.toUpperCase()

  if (name && DOCX_DENIED_FIELDS.includes(name)) {
    return fail('docx_field_instruction', `Field ${name} is not allowed`)
  }

  if (name === 'HYPERLINK') {
    const target = /"([^"]*)"/.exec(instruction)?.[1]
    const isBookmark = /\\l(?:\s|$)/i.test(instruction)

    if (!isBookmark && (!target || !startsWithAllowedProtocol(target))) {
      return fail(
        'docx_field_instruction',
        'HYPERLINK field target is not allowed',
      )
    }
  }

  return null
}

function checkFormulaText(raw: string): ValidationFailure | null {
  const checked = checkFormula(raw)

  return checked.ok ? null : fail(checked.code, checked.detail)
}

/**
 * One pass over a part's events. Every check runs on every XML part whatever
 * its path, so moving a worksheet or a document body elsewhere in the package
 * does not hide it.
 */
function scanXmlPart(
  partName: string,
  events: Generator<XmlEvent>,
  state: PackageState,
): ValidationFailure | null {
  const isRelationships = partName.endsWith('.rels')
  const sheetName = state.sheetPartNames.get(partName) ?? null
  const fields: string[] = []
  let currentCell: string | null = null
  let formulaDepth = 0
  let formulaText = ''
  let isCellFormula = false
  let isInstruction = false
  let instructionBuffer = ''
  let fieldBuffer = ''
  let isCollectingField = false

  for (const event of events) {
    if (event.type === 'text') {
      if (isInstruction) {
        instructionBuffer += event.text
      }

      if (formulaDepth > 0) {
        formulaText += event.text
      }

      const failure = state.format === 'pptx'
        ? checkPptxActionText(event.text)
        : null

      if (failure) {
        return failure
      }

      continue
    }

    if (event.type === 'end') {
      if (event.name === 'instrText' && isInstruction) {
        isInstruction = false
        fieldBuffer += instructionBuffer
        isCollectingField = true
      } else if (
        formulaDepth > 0
        && (event.name === 'f' || FORMULA_ELEMENTS.has(event.name))
      ) {
        formulaDepth -= 1

        const failure = formulaText || !isCellFormula
          ? checkFormulaText(formulaText)
          : null

        if (failure) {
          return failure
        }
      } else if (event.name === 'c') {
        currentCell = null
      }

      continue
    }

    const { name, attributes } = event

    if (state.format === 'pptx') {
      for (const value of Object.values(attributes)) {
        const failure = checkPptxActionText(value)

        if (failure) {
          return failure
        }
      }
    }

    if (isRelationships && name === 'Relationship') {
      const failure = checkRelationship(partName, attributes, state)

      if (failure) {
        return failure
      }
    } else if (name === 'fldChar') {
      if (fieldBuffer) {
        fields.push(fieldBuffer)
      }

      fieldBuffer = ''
      isCollectingField = attributes.fldCharType === 'begin'
    } else if (name === 'fldSimple') {
      fields.push(attributes.instr ?? '')
    } else if (name === 'instrText') {
      isInstruction = true
      instructionBuffer = ''
    } else if (name === 'c' && state.format === 'xlsx') {
      currentCell = attributes.r ?? ''
      state.stats.cells = (state.stats.cells ?? 0) + 1
    } else if (
      state.format === 'xlsx'
      && (name === 'f' || FORMULA_ELEMENTS.has(name))
    ) {
      formulaDepth += 1
      formulaText = ''
      isCellFormula = name === 'f'

      if (name === 'f') {
        const type = attributes.t

        if (type !== undefined && !ALLOWED_FORMULA_TYPES.includes(type)) {
          return fail(
            'xlsx_formula_type',
            `Formula type ${type.slice(0, 20)} is not allowed`,
          )
        }

        const references = sheetName && state.declared
          ? state.declared.get(sheetName)
          : undefined
        const isUndeclared = state.declared !== null
          && !references?.has(currentCell ?? '')

        if (isUndeclared) {
          return fail(
            'formula_undeclared',
            `Cell ${(currentCell ?? '').slice(0, 12)} has a formula the spec does not declare`,
          )
        }
      }
    }
  }

  if (isCollectingField && fieldBuffer) {
    fields.push(fieldBuffer)
  }

  for (const instruction of fields) {
    const failure = checkFieldInstruction(instruction)

    if (failure) {
      return failure
    }
  }

  return null
}

function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const key = name.toLowerCase()

  return entries.find(entry => entry.name.toLowerCase() === key)
}

function readSheetNames(
  workbook: string,
  workbookRelationships: string,
): Map<string, string> {
  const targets = new Map<string, string>()
  const names = new Map<string, string>()

  for (const event of parseXml(workbookRelationships)) {
    if (event.type === 'start' && event.name === 'Relationship') {
      const { Id, Target } = event.attributes

      if (Id && Target) {
        targets.set(Id, normalizePartPath('xl/workbook.xml', Target))
      }
    }
  }

  for (const event of parseXml(workbook)) {
    if (event.type === 'start' && event.name === 'sheet') {
      const target = targets.get(event.attributes.id ?? '')

      if (target && event.attributes.name) {
        names.set(target, event.attributes.name)
      }
    }
  }

  return names
}

function checkContentTypes(
  state: PackageState,
  contentTypes: string,
): ValidationFailure | null {
  const main = MAIN_PARTS[state.format]

  for (const event of parseXml(contentTypes)) {
    const isTypeElement = event.type === 'start'
      && (event.name === 'Default' || event.name === 'Override')

    if (!isTypeElement || event.type !== 'start') {
      continue
    }

    const contentType = event.attributes.ContentType ?? ''

    for (const denied of MACRO_CONTENT_TYPE_PATTERNS) {
      if (denied.pattern.test(contentType)) {
        return fail(
          denied.code,
          `Content type ${contentType.slice(0, 100)} is not allowed`,
        )
      }
    }

    if (event.name === 'Override') {
      state.contentTypeOverrides.set(
        (event.attributes.PartName ?? '').replace(/^\//, '').toLowerCase(),
        contentType,
      )
    }
  }

  const declared = state.contentTypeOverrides.get(main.part)

  if (declared !== main.contentType) {
    return fail(
      'ooxml_format_mismatch',
      `Main part ${main.part} has content type ${(declared ?? 'none').slice(0, 100)}, expected the ${state.format} main type`,
    )
  }

  return null
}

function decodePart(
  archive: Uint8Array,
  entry: ZipEntry,
): { ok: true, text: string } | ValidationFailure {
  if (entry.uncompressedSize > VALIDATION_LIMITS.xmlPartBytesMax) {
    return fail(
      'xml_part_too_large',
      `${entry.name.slice(0, 80)} declares ${entry.uncompressedSize} bytes`,
    )
  }

  const inflated = inflateEntry(archive, entry)

  if (!inflated.ok) {
    return fail(inflated.code, inflated.detail)
  }

  try {
    return { ok: true, text: decodeXmlBytes(inflated.data) }
  } catch (exception) {
    return fail(
      exception instanceof XmlError ? exception.code : 'xml_malformed',
      `${entry.name.slice(0, 80)} cannot be read as XML`,
    )
  }
}

function toFailure(exception: unknown, partName: string): ValidationFailure {
  if (exception instanceof XmlError) {
    return fail(
      exception.code,
      `${partName.slice(0, 80)}: ${exception.message}`,
    )
  }

  throw exception
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
  const state: PackageState = {
    format,
    stats: { bytes: bytes.length, entries: entries.length },
    declared: format === 'xlsx' && options.spec
      ? declaredFormulaCells(options.spec)
      : null,
    sheetPartNames: new Map(),
    contentTypeOverrides: new Map(),
    customPropertiesLinked: false,
    customProvenance: 'missing',
    slides: 0,
  }

  for (const entry of entries) {
    if (entry.name.endsWith('/')) {
      continue
    }

    for (const denied of OOXML_DENIED_PART_PATTERNS) {
      if (denied.pattern.test(entry.name)) {
        return fail(
          denied.code,
          `Part ${entry.name.slice(0, 80)} is not allowed`,
        )
      }
    }
  }

  for (const required of [CONTENT_TYPES_PART, ROOT_RELATIONSHIPS_PART]) {
    if (!findEntry(entries, required)) {
      return fail('ooxml_missing_part', `Missing ${required}`)
    }
  }

  const contentTypes = decodePart(
    bytes,
    findEntry(entries, CONTENT_TYPES_PART) as ZipEntry,
  )

  if (!contentTypes.ok) {
    return contentTypes
  }

  try {
    const typeFailure = checkContentTypes(state, contentTypes.text)

    if (typeFailure) {
      return typeFailure
    }
  } catch (exception) {
    return toFailure(exception, CONTENT_TYPES_PART)
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

  if (format === 'xlsx') {
    const workbook = decodePart(
      bytes,
      findEntry(entries, 'xl/workbook.xml') as ZipEntry,
    )
    const relationshipsEntry = findEntry(entries, 'xl/_rels/workbook.xml.rels')
    const relationships = relationshipsEntry
      ? decodePart(bytes, relationshipsEntry)
      : { ok: true as const, text: '<Relationships/>' }

    if (!workbook.ok) {
      return workbook
    }

    if (!relationships.ok) {
      return relationships
    }

    try {
      state.sheetPartNames = readSheetNames(workbook.text, relationships.text)
    } catch (exception) {
      return toFailure(exception, 'xl/workbook.xml')
    }

    state.stats.sheets = state.sheetPartNames.size
  }

  let totalXmlBytes = 0

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase()

    if (
      entry.name.endsWith('/')
      || lowerName === CONTENT_TYPES_PART
      || !XML_PART_PATTERN.test(entry.name)
    ) {
      continue
    }

    totalXmlBytes += entry.uncompressedSize

    if (totalXmlBytes > VALIDATION_LIMITS.xmlTotalBytesMax) {
      return fail('xml_part_too_large', 'XML parts exceed the total limit')
    }

    const content = decodePart(bytes, entry)

    if (!content.ok) {
      return content
    }

    try {
      if (lowerName === CUSTOM_PROPERTIES_PART) {
        state.customProvenance = readOoxmlProvenance(content.text)
      }

      const failure = scanXmlPart(lowerName, parseXml(content.text), state)

      if (failure) {
        return failure
      }
    } catch (exception) {
      return toFailure(exception, entry.name)
    }

    if (format === 'pptx' && /^ppt\/slides\/slide\d+\.xml$/.test(lowerName)) {
      state.slides += 1
    }
  }

  if (format === 'pptx') {
    state.stats.slides = state.slides
  }

  return {
    ok: true,
    stats: state.stats,
    provenance: state.customPropertiesLinked
      ? state.customProvenance
      : 'missing',
  }
}
