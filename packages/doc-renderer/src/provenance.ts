export const DIGITAL_SOURCE_TYPE = {
  trainedAlgorithmicMedia:
    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  compositeWithTrainedAlgorithmicMedia:
    'http://cv.iptc.org/newscodes/digitalsourcetype/'
    + 'compositeWithTrainedAlgorithmicMedia',
} as const

export const IPTC_EXT_NAMESPACE = 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/'
export const BESIDKA_NAMESPACE = 'https://besidka.com/ns/provenance/1.0/'
export const GENERATOR_NAME = 'Besidka'
export const MAX_MODEL_ID_LENGTH = 200

export const PROPERTY_DIGITAL_SOURCE_TYPE = 'Iptc4xmpExt:DigitalSourceType'
export const PROPERTY_AI_SYSTEM_USED = 'Iptc4xmpExt:AISystemUsed'
export const PROPERTY_GENERATOR = 'besidka:generator'
export const PROPERTY_CREATED_VIA = 'besidka:createdVia'
export const LEGACY_PROPERTY_DIGITAL_SOURCE_TYPE = 'besidka:digitalSourceType'

export type CreatedVia = 'chat' | 'mcp' | 'research' | 'code-execution'

export type Provenance = 'ai' | 'channel-only' | 'missing'

export interface ProvenanceInput {
  model?: string | null
  createdVia: CreatedVia
  aiGenerated?: boolean
}

export interface XmpInput extends ProvenanceInput {
  title?: string
  language?: string
}

export interface ProvenanceProperty {
  name: string
  value: string
}

const AI_SOURCE_TYPE_PATTERN
  = /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/(?:trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia)$/
const CREATED_VIA_PATTERN = /^[a-z][a-z-]{0,31}$/
const CUSTOM_PROPERTIES_FORMAT_ID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
      return String.fromCodePoint(Number.parseInt(hex, 16))
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      return String.fromCodePoint(Number.parseInt(decimal, 10))
    })
    .replace(/&amp;/g, '&')
}

export function sanitizeXmlText(value: string, maxLength: number): string {
  const printable = Array.from(value).map((character) => {
    const codePoint = character.codePointAt(0) || 0
    const isInvalidInXml = codePoint < 0x20
      || codePoint === 0x7f
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      || codePoint === 0xfffe
      || codePoint === 0xffff

    return isInvalidInXml ? ' ' : character
  })

  return printable.join('').trim().slice(0, maxLength)
}

export function sanitizeModelId(model: string): string {
  return sanitizeXmlText(model, MAX_MODEL_ID_LENGTH)
}

function assertCreatedVia(createdVia: string): void {
  if (!CREATED_VIA_PATTERN.test(createdVia)) {
    throw new RangeError('Invalid createdVia value')
  }
}

/**
 * The marking carries the model id and the creation channel only: never a
 * prompt, a user id or a chat id (EU AI Act Art. 50(2) marking).
 */
export function buildProvenanceProperties(
  input: ProvenanceInput,
): ProvenanceProperty[] {
  assertCreatedVia(input.createdVia)

  const properties: ProvenanceProperty[] = []
  const isAiGenerated = input.aiGenerated !== false

  if (isAiGenerated) {
    properties.push({
      name: PROPERTY_DIGITAL_SOURCE_TYPE,
      value: DIGITAL_SOURCE_TYPE.trainedAlgorithmicMedia,
    })

    const model = input.model ? sanitizeModelId(input.model) : ''

    if (model) {
      properties.push({ name: PROPERTY_AI_SYSTEM_USED, value: model })
    }
  }

  properties.push({ name: PROPERTY_GENERATOR, value: GENERATOR_NAME })
  properties.push({ name: PROPERTY_CREATED_VIA, value: input.createdVia })

  return properties
}

export function buildOoxmlCustomProps(input: ProvenanceInput): string {
  const properties = buildProvenanceProperties(input)
  const elements = properties.map((property, index) => {
    return `<property fmtid="${CUSTOM_PROPERTIES_FORMAT_ID}" pid="${index + 2}"`
      + ` name="${escapeXml(property.name)}">`
      + `<vt:lpwstr>${escapeXml(property.value)}</vt:lpwstr></property>`
  })

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + elements.join('')
    + '</Properties>'
}

export function buildPdfXmp(input: XmpInput): string {
  const properties = buildProvenanceProperties(input)
  const iptcAttributes = properties
    .filter(property => property.name.startsWith('Iptc4xmpExt:'))
    .map(property => `${property.name}="${escapeXml(property.value)}"`)
  const besidkaAttributes = properties
    .filter(property => property.name.startsWith('besidka:'))
    .map(property => `${property.name}="${escapeXml(property.value)}"`)
  const descriptions: string[] = []

  if (iptcAttributes.length > 0) {
    descriptions.push(
      `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_EXT_NAMESPACE}"`
      + ` ${iptcAttributes.join(' ')}/>`,
    )
  }

  descriptions.push(
    `<rdf:Description rdf:about="" xmlns:besidka="${BESIDKA_NAMESPACE}"`
    + ` ${besidkaAttributes.join(' ')}/>`,
  )

  if (input.title || input.language) {
    const title = input.title
      ? '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">'
      + `${escapeXml(sanitizeXmlText(input.title, 200))}</rdf:li></rdf:Alt></dc:title>`
      : ''
    const language = input.language
      ? `<dc:language><rdf:Bag><rdf:li>${escapeXml(input.language)}</rdf:li></rdf:Bag></dc:language>`
      : ''

    descriptions.push(
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
      + `${title}${language}</rdf:Description>`,
    )
  }

  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    ...descriptions,
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n')
}

export function isAiDigitalSourceType(value: string): boolean {
  return AI_SOURCE_TYPE_PATTERN.test(value.trim())
}

export function readOoxmlProvenance(customPropertiesXml: string): Provenance {
  const properties = new Map<string, string>()
  const pattern
    = /<property\b[^>]*?\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g

  for (const match of customPropertiesXml.matchAll(pattern)) {
    const valueMatch = /<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/.exec(
      match[2] || '',
    )

    properties.set(
      unescapeXml(match[1] || ''),
      unescapeXml(valueMatch?.[1] || ''),
    )
  }

  const sourceType = properties.get(PROPERTY_DIGITAL_SOURCE_TYPE)
    ?? properties.get(LEGACY_PROPERTY_DIGITAL_SOURCE_TYPE)

  if (sourceType && isAiDigitalSourceType(sourceType)) {
    return 'ai'
  }

  return properties.has(PROPERTY_CREATED_VIA) ? 'channel-only' : 'missing'
}

export function readXmpProvenance(xmp: string): Provenance {
  const sourceTypePattern
    = /Iptc4xmpExt:DigitalSourceType(?:\s*=\s*["']([^"']*)["']|\s*>\s*([^<]*)<)/g

  for (const match of xmp.matchAll(sourceTypePattern)) {
    if (isAiDigitalSourceType(unescapeXml(match[1] ?? match[2] ?? ''))) {
      return 'ai'
    }
  }

  return /besidka:createdVia\s*=\s*["'][^"']+["']/.test(xmp)
    ? 'channel-only'
    : 'missing'
}
