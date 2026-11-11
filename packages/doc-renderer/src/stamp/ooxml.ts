import { zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import {
  buildProvenanceProperties,
  escapeXml,
  unescapeXml,
} from '../provenance.ts'
import type { ProvenanceInput } from '../provenance.ts'
import { PINNED_DOCUMENT_DATE } from '../constants.ts'
import { inflateEntry } from '../validate/inflate.ts'
import { fail } from '../validate/result.ts'
import type { ValidationFailure } from '../validate/result.ts'
import { readZipDirectory } from '../validate/zip.ts'

export interface StampOoxmlOptions extends ProvenanceInput {
  title?: string
  language?: string
  createdAt?: string
  normalizeParts?: (parts: Map<string, Uint8Array>) => void
}

const CONTENT_TYPES_PART = '[Content_Types].xml'
const ROOT_RELATIONSHIPS_PART = '_rels/.rels'
const CORE_PART = 'docProps/core.xml'
const CUSTOM_PART = 'docProps/custom.xml'
const CORE_CONTENT_TYPE
  = 'application/vnd.openxmlformats-package.core-properties+xml'
const CUSTOM_CONTENT_TYPE
  = 'application/vnd.openxmlformats-officedocument.custom-properties+xml'
const CORE_RELATIONSHIP_TYPE
  = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
const CUSTOM_RELATIONSHIP_TYPE
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'
const CUSTOM_PROPERTIES_FORMAT_ID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'
const ISO_DATE_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

function fixedZipDate(): Date {
  return new Date(2026, 0, 1, 0, 0, 0)
}

function setDateElement(core: string, tag: string, date: string): string {
  const element = `<${tag} xsi:type="dcterms:W3CDTF">${date}</${tag}>`
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`)

  if (pattern.test(core)) {
    return core.replace(pattern, element)
  }

  return core.replace('</cp:coreProperties>', `${element}</cp:coreProperties>`)
}

function setTextElement(core: string, tag: string, value: string): string {
  const element = `<${tag}>${escapeXml(value)}</${tag}>`
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`)

  if (pattern.test(core)) {
    return core.replace(pattern, element)
  }

  return core.replace('</cp:coreProperties>', `${element}</cp:coreProperties>`)
}

function buildCoreProperties(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<cp:coreProperties'
    + ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:dcmitype="http://purl.org/dc/dcmitype/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '</cp:coreProperties>'
}

function mergeCustomProperties(
  existing: string | null,
  input: ProvenanceInput,
): string {
  const ours = buildProvenanceProperties(input)
  const preserved: string[] = []
  let maxPid = 1

  if (existing) {
    for (const match of existing.matchAll(/<property\b[^>]*>[\s\S]*?<\/property>/g)) {
      const element = match[0]
      const name = /\bname="([^"]*)"/.exec(element)?.[1]

      if (name !== undefined && /^(?:Iptc4xmpExt:|besidka:)/.test(unescapeXml(name))) {
        continue
      }

      const pid = Number(/\bpid="(\d+)"/.exec(element)?.[1] || 0)

      maxPid = Math.max(maxPid, pid)
      preserved.push(element)
    }
  }

  const added = ours.map((property, index) => {
    return `<property fmtid="${CUSTOM_PROPERTIES_FORMAT_ID}" pid="${maxPid + index + 1}"`
      + ` name="${escapeXml(property.name)}">`
      + `<vt:lpwstr>${escapeXml(property.value)}</vt:lpwstr></property>`
  })

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + preserved.join('')
    + added.join('')
    + '</Properties>'
}

function addContentTypeOverride(
  contentTypes: string,
  partName: string,
  contentType: string,
): string {
  if (contentTypes.includes(`PartName="${partName}"`)) {
    return contentTypes
  }

  return contentTypes.replace(
    '</Types>',
    `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`,
  )
}

function addRootRelationship(
  relationships: string,
  type: string,
  target: string,
  id: string,
): string {
  if (relationships.includes(`Type="${type}"`)) {
    return relationships
  }

  return relationships.replace(
    '</Relationships>',
    `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`,
  )
}

/**
 * Adds provenance (and, when asked, the document title, language and pinned
 * dates) to an existing OOXML package without re-rendering. Reading goes
 * through the central-directory limits and the streaming inflate cap, so a
 * provider-made file is bounded the same way as in `validate()`. The package
 * is re-zipped with fixed entry times and the original entry order, which
 * makes the output byte-stable for goldens.
 */
export function stampOoxml(
  bytes: Uint8Array,
  options: StampOoxmlOptions,
): { ok: true, bytes: Uint8Array } | ValidationFailure {
  const zip = readZipDirectory(bytes)

  if (!zip.ok) {
    return fail(zip.code, zip.detail)
  }

  const hasInvalidDate = options.createdAt !== undefined
    && !ISO_DATE_PATTERN.test(options.createdAt)

  if (hasInvalidDate) {
    return fail('stamp_invalid_date', 'createdAt must be an ISO-8601 instant')
  }

  const parts = new Map<string, Uint8Array>()

  for (const entry of zip.directory.entries) {
    if (entry.name.endsWith('/')) {
      continue
    }

    const inflated = inflateEntry(bytes, entry)

    if (!inflated.ok) {
      return fail(inflated.code, inflated.detail)
    }

    parts.set(entry.name, inflated.data)
  }

  const contentTypesBytes = parts.get(CONTENT_TYPES_PART)
  const relationshipsBytes = parts.get(ROOT_RELATIONSHIPS_PART)

  if (!contentTypesBytes || !relationshipsBytes) {
    return fail('ooxml_missing_part', 'Missing content types or root relationships')
  }

  let contentTypes = textDecoder.decode(contentTypesBytes)
  let relationships = textDecoder.decode(relationshipsBytes)
  const existingCustom = parts.get(CUSTOM_PART)

  parts.set(
    CUSTOM_PART,
    textEncoder.encode(
      mergeCustomProperties(
        existingCustom ? textDecoder.decode(existingCustom) : null,
        options,
      ),
    ),
  )
  contentTypes = addContentTypeOverride(
    contentTypes,
    `/${CUSTOM_PART}`,
    CUSTOM_CONTENT_TYPE,
  )
  relationships = addRootRelationship(
    relationships,
    CUSTOM_RELATIONSHIP_TYPE,
    CUSTOM_PART,
    'rIdBesidkaCustom',
  )

  const shouldTouchCore = options.title !== undefined
    || options.language !== undefined
    || options.createdAt !== undefined

  if (shouldTouchCore) {
    const existingCore = parts.get(CORE_PART)
    let core = existingCore
      ? textDecoder.decode(existingCore)
      : buildCoreProperties()

    if (options.title !== undefined) {
      core = setTextElement(core, 'dc:title', options.title)
    }

    if (options.language !== undefined) {
      core = setTextElement(core, 'dc:language', options.language)
    }

    if (options.createdAt !== undefined) {
      core = setDateElement(core, 'dcterms:created', options.createdAt)
      core = setDateElement(core, 'dcterms:modified', options.createdAt)
    }

    parts.set(CORE_PART, textEncoder.encode(core))
    contentTypes = addContentTypeOverride(contentTypes, `/${CORE_PART}`, CORE_CONTENT_TYPE)
    relationships = addRootRelationship(
      relationships,
      CORE_RELATIONSHIP_TYPE,
      CORE_PART,
      'rIdBesidkaCore',
    )
  }

  parts.set(CONTENT_TYPES_PART, textEncoder.encode(contentTypes))
  parts.set(ROOT_RELATIONSHIPS_PART, textEncoder.encode(relationships))
  options.normalizeParts?.(parts)

  const mtime = fixedZipDate()
  const archive: Zippable = {}

  for (const [name, data] of parts) {
    archive[name] = [data, { level: 6, mtime }]
  }

  return { ok: true, bytes: zipSync(archive) }
}

export { PINNED_DOCUMENT_DATE }
