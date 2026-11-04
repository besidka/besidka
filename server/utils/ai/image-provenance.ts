import type { ValidatedGeneratedImage } from '~~/server/utils/ai/image-generation'

export type AiImageMarking
  = | 'upstream-c2pa'
    | 'upstream-xmp'
    | 'existing-xmp-unmarked'
    | 'merged-xmp'
    | 'added-xmp'
    | 'skipped-oversize'
    | 'unsupported'

export interface MarkAiGeneratedImageInput {
  data: Uint8Array
  mediaType: ValidatedGeneratedImage['mediaType']
  model?: string | null
  isEdit?: boolean
  maxBytes?: number
}

export interface MarkAiGeneratedImageResult {
  data: Uint8Array
  marking: AiImageMarking
}

type XmpKind = 'ai' | 'other' | 'opaque' | 'plain'

interface XmpCandidate {
  kind: XmpKind
  text: string
  rebuild: (mergedText: string) => Uint8Array | null
}

interface PacketOptions {
  model: string | null
  isEdit: boolean
}

interface WebPChunk {
  type: string
  offset: number
  length: number
  end: number
}

const TRAINED_ALGORITHMIC_MEDIA
  = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
const COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA
  = 'http://cv.iptc.org/newscodes/digitalsourcetype/'
    + 'compositeWithTrainedAlgorithmicMedia'
const AI_SOURCE_TYPE_PATTERN
  = /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/(?:trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia)$/
const SOURCE_TYPE_VALUE_PATTERN
  = /DigitalSourceType(?:\s*=\s*|\s*>\s*|[^<>]*?resource\s*=\s*)["']?([^"'<>\s]*)/g
const RDF_CLOSING_TAG = '</rdf:RDF>'
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp'
const PNG_KEYWORD_SCAN_LIMIT = 80
const JPEG_XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'
const MAX_MODEL_ID_LENGTH = 200
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP_XMP_FLAG = 0x04
const WEBP_ALPHA_FLAG = 0x10

const crcTable = buildCrcTable()
const textEncoder = new TextEncoder()
const strictTextDecoder = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
})

/**
 * Adds a machine-readable AI-generated marking (EU AI Act Art. 50(2)) to an
 * image without re-encoding pixels. Images that already carry a C2PA manifest
 * or an AI DigitalSourceType are returned byte-identical, because appending
 * anything to a C2PA-signed file would break its hard-binding hash. An
 * existing uncompressed XMP packet without a DigitalSourceType gets our
 * description merged in. When `maxBytes` is set and marking would exceed it,
 * the original bytes are returned. Never throws: any parse problem yields the
 * original bytes with the `unsupported` marking.
 */
export function markAiGeneratedImage(
  input: MarkAiGeneratedImageInput,
): MarkAiGeneratedImageResult {
  const options: PacketOptions = {
    model: input.model ?? null,
    isEdit: input.isEdit === true,
  }

  try {
    const result = markByMediaType(input, options)
    const isChanged = result.marking === 'added-xmp'
      || result.marking === 'merged-xmp'

    if (
      isChanged
      && input.maxBytes !== undefined
      && result.data.length > input.maxBytes
    ) {
      return { data: input.data, marking: 'skipped-oversize' }
    }

    return result
  } catch {
    return { data: input.data, marking: 'unsupported' }
  }
}

function markByMediaType(
  input: MarkAiGeneratedImageInput,
  options: PacketOptions,
): MarkAiGeneratedImageResult {
  if (input.mediaType === 'image/png') {
    return markPng(input.data, options)
  }

  if (input.mediaType === 'image/jpeg') {
    return markJpeg(input.data, options)
  }

  if (input.mediaType === 'image/webp') {
    return markWebP(input.data, options)
  }

  return { data: input.data, marking: 'unsupported' }
}

function markPng(
  data: Uint8Array,
  options: PacketOptions,
): MarkAiGeneratedImageResult {
  if (!PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    throw new RangeError('Not a PNG file')
  }

  let offset = PNG_SIGNATURE.length
  let hasC2pa = false
  let hasEnd = false
  let headerEnd = -1
  const candidates: XmpCandidate[] = []

  while (offset < data.length) {
    if (offset + 12 > data.length) {
      throw new RangeError('Truncated PNG chunk')
    }

    const chunkLength = readUint32BigEndian(data, offset)
    const chunkEnd = offset + 12 + chunkLength

    if (chunkEnd > data.length) {
      throw new RangeError('Truncated PNG chunk')
    }

    const chunkType = readAscii(data, offset + 4, 4)

    if (headerEnd === -1) {
      if (chunkType !== 'IHDR') {
        throw new RangeError('PNG does not start with IHDR')
      }

      headerEnd = chunkEnd
    }

    if (chunkType === 'caBX') {
      hasC2pa = true
    }

    if (
      chunkType === 'iTXt'
      || chunkType === 'zTXt'
      || chunkType === 'tEXt'
    ) {
      const candidate = readPngXmpCandidate(
        data,
        chunkType,
        offset,
        chunkEnd,
      )

      if (candidate) {
        candidates.push(candidate)
      }
    }

    offset = chunkEnd

    if (chunkType === 'IEND') {
      hasEnd = true
      break
    }
  }

  if (!hasEnd || headerEnd === -1) {
    throw new RangeError('PNG has no IEND chunk')
  }

  const existing = resolveExistingMarking(data, hasC2pa, candidates, options)

  if (existing) {
    return existing
  }

  const textPayload = concatBytes([
    textEncoder.encode(`${PNG_XMP_KEYWORD}\0`),
    new Uint8Array([0, 0]),
    new Uint8Array([0, 0]),
    buildXmpPacket(options),
  ])

  return {
    data: concatBytes([
      data.subarray(0, headerEnd),
      buildPngChunk('iTXt', textPayload),
      data.subarray(headerEnd),
    ]),
    marking: 'added-xmp',
  }
}

function readPngXmpCandidate(
  data: Uint8Array,
  chunkType: 'iTXt' | 'zTXt' | 'tEXt',
  chunkStart: number,
  chunkEnd: number,
): XmpCandidate | null {
  const payloadStart = chunkStart + 8
  const payloadEnd = chunkEnd - 4
  const keywordEnd = data
    .subarray(
      payloadStart,
      Math.min(payloadEnd, payloadStart + PNG_KEYWORD_SCAN_LIMIT),
    )
    .indexOf(0)

  if (
    keywordEnd === -1
    || readAscii(data, payloadStart, keywordEnd) !== PNG_XMP_KEYWORD
  ) {
    return null
  }

  const opaque: XmpCandidate = {
    kind: 'opaque',
    text: '',
    rebuild: () => null,
  }

  if (chunkType === 'zTXt') {
    return opaque
  }

  let textStart = payloadStart + keywordEnd + 1

  if (chunkType === 'iTXt') {
    if (data[textStart] !== 0) {
      return opaque
    }

    textStart += 2

    for (let field = 0; field < 2; field += 1) {
      const fieldEnd = data.subarray(textStart, payloadEnd).indexOf(0)

      if (fieldEnd === -1) {
        return opaque
      }

      textStart += fieldEnd + 1
    }
  }

  const prefix = data.subarray(payloadStart, textStart)

  return buildCandidate(data.subarray(textStart, payloadEnd), (mergedText) => {
    return concatBytes([
      data.subarray(0, chunkStart),
      buildPngChunk(
        chunkType,
        concatBytes([prefix, textEncoder.encode(mergedText)]),
      ),
      data.subarray(chunkEnd),
    ])
  })
}

function markJpeg(
  data: Uint8Array,
  options: PacketOptions,
): MarkAiGeneratedImageResult {
  const hasContainerMarkers = data.length >= 4
    && data[0] === 0xff
    && data[1] === 0xd8
    && data[data.length - 2] === 0xff
    && data[data.length - 1] === 0xd9

  if (!hasContainerMarkers) {
    throw new RangeError('Not a complete JPEG file')
  }

  let offset = 2
  let insertOffset = 2
  let isLeading = true
  let hasScan = false
  let hasC2pa = false
  const candidates: XmpCandidate[] = []

  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      throw new RangeError('Invalid JPEG marker')
    }

    while (data[offset] === 0xff) {
      offset += 1
    }

    const marker = data[offset]

    if (marker === undefined || marker === 0x00 || marker === 0xd8) {
      throw new RangeError('Invalid JPEG marker')
    }

    offset += 1

    if (marker === 0xd9) {
      throw new RangeError('JPEG ended before scan data')
    }

    if (marker === 0xda) {
      hasScan = true
      break
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }

    if (offset + 2 > data.length) {
      throw new RangeError('Truncated JPEG segment')
    }

    const segmentStart = offset - 2
    const segmentLength = readUint16BigEndian(data, offset)
    const segmentEnd = offset + segmentLength

    if (segmentLength < 2 || segmentEnd > data.length) {
      throw new RangeError('Truncated JPEG segment')
    }

    const payload = data.subarray(offset + 2, segmentEnd)

    if (marker === 0xeb && isC2paJumbfPayload(payload)) {
      hasC2pa = true
    }

    if (marker === 0xe1 && startsWithAscii(payload, JPEG_XMP_HEADER)) {
      candidates.push(
        buildCandidate(
          payload.subarray(JPEG_XMP_HEADER.length),
          (mergedText) => {
            return rebuildJpegXmpSegment(
              data,
              segmentStart,
              segmentEnd,
              mergedText,
            )
          },
        ),
      )
    }

    if (isLeading) {
      const isApplicationSegment = marker >= 0xe0 && marker <= 0xef

      if (isApplicationSegment) {
        insertOffset = segmentEnd
      } else {
        isLeading = false
      }
    }

    offset = segmentEnd
  }

  if (!hasScan) {
    throw new RangeError('JPEG has no scan data')
  }

  const existing = resolveExistingMarking(data, hasC2pa, candidates, options)

  if (existing) {
    return existing
  }

  const segment = buildJpegXmpSegment(buildXmpPacket(options))

  if (!segment) {
    throw new RangeError('XMP segment too large')
  }

  return {
    data: concatBytes([
      data.subarray(0, insertOffset),
      segment,
      data.subarray(insertOffset),
    ]),
    marking: 'added-xmp',
  }
}

function buildJpegXmpSegment(packet: Uint8Array): Uint8Array | null {
  const segmentPayload = concatBytes([
    textEncoder.encode(JPEG_XMP_HEADER),
    packet,
  ])
  const segmentLength = segmentPayload.length + 2

  if (segmentLength > 0xffff) {
    return null
  }

  return concatBytes([
    new Uint8Array([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]),
    segmentPayload,
  ])
}

function rebuildJpegXmpSegment(
  data: Uint8Array,
  segmentStart: number,
  segmentEnd: number,
  mergedText: string,
): Uint8Array | null {
  const segment = buildJpegXmpSegment(textEncoder.encode(mergedText))

  if (!segment) {
    return null
  }

  return concatBytes([
    data.subarray(0, segmentStart),
    segment,
    data.subarray(segmentEnd),
  ])
}

function isC2paJumbfPayload(payload: Uint8Array): boolean {
  return indexOfAscii(payload, 'jumb') !== -1
    && indexOfAscii(payload, 'c2pa') !== -1
}

function markWebP(
  data: Uint8Array,
  options: PacketOptions,
): MarkAiGeneratedImageResult {
  if (
    data.length < 20
    || readAscii(data, 0, 4) !== 'RIFF'
    || readAscii(data, 8, 4) !== 'WEBP'
    || readUint32LittleEndian(data, 4) + 8 !== data.length
  ) {
    throw new RangeError('Not a WebP file')
  }

  const chunks = readWebPChunks(data)
  let hasC2pa = false
  const candidates: XmpCandidate[] = []

  for (const chunk of chunks) {
    if (chunk.type === 'C2PA') {
      hasC2pa = true
    }

    if (chunk.type === 'XMP ') {
      candidates.push(
        buildCandidate(
          data.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.length),
          (mergedText) => {
            const marked = concatBytes([
              data.subarray(0, chunk.offset),
              buildWebPChunk('XMP ', textEncoder.encode(mergedText)),
              data.subarray(chunk.end),
            ])

            writeUint32LittleEndian(marked, 4, marked.length - 8)

            return marked
          },
        ),
      )
    }
  }

  const existing = resolveExistingMarking(data, hasC2pa, candidates, options)

  if (existing) {
    return existing
  }

  const firstChunk = chunks[0]

  if (!firstChunk) {
    throw new RangeError('WebP has no chunks')
  }

  const xmpChunk = buildWebPChunk('XMP ', buildXmpPacket(options))

  if (firstChunk.type === 'VP8X') {
    if (firstChunk.offset !== 12 || firstChunk.length < 10) {
      throw new RangeError('Unexpected VP8X layout')
    }

    const marked = concatBytes([data, xmpChunk])

    marked[firstChunk.offset + 8] = (marked[firstChunk.offset + 8] || 0)
      | WEBP_XMP_FLAG
    writeUint32LittleEndian(marked, 4, marked.length - 8)

    return { data: marked, marking: 'added-xmp' }
  }

  if (
    chunks.length !== 1
    || (firstChunk.type !== 'VP8 ' && firstChunk.type !== 'VP8L')
  ) {
    throw new RangeError('Unknown WebP layout')
  }

  const extendedHeader = buildWebPChunk(
    'VP8X',
    buildVp8xPayload(data, firstChunk),
  )
  const marked = concatBytes([
    data.subarray(0, 12),
    extendedHeader,
    data.subarray(12),
    xmpChunk,
  ])

  writeUint32LittleEndian(marked, 4, marked.length - 8)

  return { data: marked, marking: 'added-xmp' }
}

function readWebPChunks(data: Uint8Array): WebPChunk[] {
  const chunks: WebPChunk[] = []
  let offset = 12

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      throw new RangeError('Truncated WebP chunk')
    }

    const length = readUint32LittleEndian(data, offset + 4)
    const end = offset + 8 + length + (length % 2)

    if (end > data.length) {
      throw new RangeError('Truncated WebP chunk')
    }

    chunks.push({
      type: readAscii(data, offset, 4),
      offset,
      length,
      end,
    })

    offset = end
  }

  return chunks
}

function buildVp8xPayload(data: Uint8Array, imageChunk: WebPChunk): Uint8Array {
  const payloadStart = imageChunk.offset + 8
  let flags = WEBP_XMP_FLAG
  let width: number
  let height: number

  if (imageChunk.type === 'VP8 ') {
    const hasStartCode = imageChunk.length > 10
      && data[payloadStart + 3] === 0x9d
      && data[payloadStart + 4] === 0x01
      && data[payloadStart + 5] === 0x2a

    if (!hasStartCode) {
      throw new RangeError('Invalid VP8 key frame')
    }

    width = readUint16LittleEndian(data, payloadStart + 6) & 0x3fff
    height = readUint16LittleEndian(data, payloadStart + 8) & 0x3fff
  } else {
    if (imageChunk.length < 5 || data[payloadStart] !== 0x2f) {
      throw new RangeError('Invalid VP8L header')
    }

    const header = readUint32LittleEndian(data, payloadStart + 1)

    width = (header & 0x3fff) + 1
    height = ((header >>> 14) & 0x3fff) + 1

    if (((header >>> 28) & 1) === 1) {
      flags |= WEBP_ALPHA_FLAG
    }
  }

  if (width < 1 || height < 1) {
    throw new RangeError('Invalid WebP dimensions')
  }

  const payload = new Uint8Array(10)

  payload[0] = flags
  writeUint24LittleEndian(payload, 4, width - 1)
  writeUint24LittleEndian(payload, 7, height - 1)

  return payload
}

function buildWebPChunk(type: string, payload: Uint8Array): Uint8Array {
  const paddingLength = payload.length % 2
  const chunk = new Uint8Array(8 + payload.length + paddingLength)

  chunk.set(textEncoder.encode(type), 0)
  writeUint32LittleEndian(chunk, 4, payload.length)
  chunk.set(payload, 8)

  return chunk
}

function buildCandidate(
  bytes: Uint8Array,
  rebuild: XmpCandidate['rebuild'],
): XmpCandidate {
  const text = decodeXmpText(bytes)

  if (text === null) {
    return { kind: 'opaque', text: '', rebuild: () => null }
  }

  return { kind: classifyXmpText(text), text, rebuild }
}

function decodeXmpText(bytes: Uint8Array): string | null {
  try {
    return strictTextDecoder.decode(bytes)
  } catch {
    return null
  }
}

function classifyXmpText(text: string): XmpKind {
  const values = [...text.matchAll(SOURCE_TYPE_VALUE_PATTERN)]
    .map(match => match[1] || '')

  if (values.some(value => AI_SOURCE_TYPE_PATTERN.test(value))) {
    return 'ai'
  }

  if (values.length > 0 || text.includes('DigitalSourceType')) {
    return 'other'
  }

  return text.includes(RDF_CLOSING_TAG) ? 'plain' : 'opaque'
}

function resolveExistingMarking(
  data: Uint8Array,
  hasC2pa: boolean,
  candidates: XmpCandidate[],
  options: PacketOptions,
): MarkAiGeneratedImageResult | null {
  if (hasC2pa) {
    return { data, marking: 'upstream-c2pa' }
  }

  if (candidates.length === 0) {
    return null
  }

  if (candidates.some(candidate => candidate.kind === 'ai')) {
    return { data, marking: 'upstream-xmp' }
  }

  const target = candidates[0]

  if (!target || candidates.some(candidate => candidate.kind !== 'plain')) {
    return { data, marking: 'existing-xmp-unmarked' }
  }

  const insertAt = target.text.lastIndexOf(RDF_CLOSING_TAG)
  const mergedText = target.text.slice(0, insertAt)
    + buildDescriptionElement(options)
    + target.text.slice(insertAt)
  const merged = target.rebuild(mergedText)

  if (!merged) {
    return { data, marking: 'existing-xmp-unmarked' }
  }

  return { data: merged, marking: 'merged-xmp' }
}

function buildDescriptionElement(options: PacketOptions): string {
  const sourceType = options.isEdit
    ? COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA
    : TRAINED_ALGORITHMIC_MEDIA
  const attributes = [
    'rdf:about=""',
    'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"',
    `Iptc4xmpExt:DigitalSourceType="${sourceType}"`,
  ]
  const model = options.model ? sanitizeModelId(options.model) : ''

  if (model) {
    attributes.push(`Iptc4xmpExt:AISystemUsed="${escapeXml(model)}"`)
  }

  return `<rdf:Description ${attributes.join(' ')}/>`
}

function buildXmpPacket(options: PacketOptions): Uint8Array {
  const packet = [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    buildDescriptionElement(options),
    RDF_CLOSING_TAG,
    '</x:xmpmeta>',
    '<?xpacket end="r"?>',
  ].join('\n')

  return textEncoder.encode(packet)
}

function sanitizeModelId(model: string): string {
  const printable = Array.from(model).map((character) => {
    const codePoint = character.codePointAt(0) || 0
    const isInvalidInXml = codePoint < 0x20
      || codePoint === 0x7f
      || codePoint === 0xfffe
      || codePoint === 0xffff

    return isInvalidInXml ? ' ' : character
  })

  return printable.join('').trim().slice(0, MAX_MODEL_ID_LENGTH)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildPngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)

  view.setUint32(0, payload.length)
  chunk.set(textEncoder.encode(type), 4)
  chunk.set(payload, 8)
  view.setUint32(
    8 + payload.length,
    crc32(chunk.subarray(4, 8 + payload.length)),
  )

  return chunk
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    table[index] = value >>> 0
  }

  return table
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length))
}

function startsWithAscii(data: Uint8Array, prefix: string): boolean {
  if (data.length < prefix.length) {
    return false
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (data[index] !== prefix.charCodeAt(index)) {
      return false
    }
  }

  return true
}

function indexOfAscii(data: Uint8Array, needle: string): number {
  const limit = data.length - needle.length

  for (let start = 0; start <= limit; start += 1) {
    let isMatch = true

    for (let index = 0; index < needle.length; index += 1) {
      if (data[start + index] !== needle.charCodeAt(index)) {
        isMatch = false
        break
      }
    }

    if (isMatch) {
      return start
    }
  }

  return -1
}

function readUint16BigEndian(data: Uint8Array, offset: number): number {
  return ((data[offset] || 0) << 8) | (data[offset + 1] || 0)
}

function readUint16LittleEndian(data: Uint8Array, offset: number): number {
  return (data[offset] || 0) | ((data[offset + 1] || 0) << 8)
}

function readUint32BigEndian(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] || 0) * 0x1000000)
    + ((data[offset + 1] || 0) << 16)
    + ((data[offset + 2] || 0) << 8)
    + (data[offset + 3] || 0)
  )
}

function readUint32LittleEndian(data: Uint8Array, offset: number): number {
  return (
    (data[offset] || 0)
    + ((data[offset + 1] || 0) << 8)
    + ((data[offset + 2] || 0) << 16)
    + ((data[offset + 3] || 0) * 0x1000000)
  )
}

function writeUint24LittleEndian(
  data: Uint8Array,
  offset: number,
  value: number,
): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
}

function writeUint32LittleEndian(
  data: Uint8Array,
  offset: number,
  value: number,
): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
  data[offset + 3] = (value >>> 24) & 0xff
}
