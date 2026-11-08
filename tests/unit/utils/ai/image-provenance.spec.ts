import { crc32 } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { validateGeneratedImage } from '~~/server/utils/ai/image-generation'
import { markAiGeneratedImage } from '~~/server/utils/ai/image-provenance'

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp'

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: vi.fn(),
}))

vi.mock('~~/server/utils/ai/image-generation-lock', () => ({
  acquireImageGenerationLease: vi.fn(),
  releaseImageGenerationLease: vi.fn(),
}))

const SOURCE_TYPE_BASE = 'http://cv.iptc.org/newscodes/digitalsourcetype/'
const TRAINED = `${SOURCE_TYPE_BASE}trainedAlgorithmicMedia`
const COMPOSITE = `${SOURCE_TYPE_BASE}compositeWithTrainedAlgorithmicMedia`
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'
const RDF_OPEN = '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
  + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
const RDF_CLOSE = '</rdf:RDF></x:xmpmeta>'
const DC_DESCRIPTION
  = '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' dc:format="image/png"/>'
const PLAIN_XMP = `${RDF_OPEN}${DC_DESCRIPTION}${RDF_CLOSE}`
const OPAQUE_XMP
  = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF'
    + ' xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'
const MARKED_XMP = buildSourceTypeXmp(TRAINED)
const OTHER_XMP = buildSourceTypeXmp(`${SOURCE_TYPE_BASE}digitalCapture`)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function buildSourceTypeXmp(sourceType: string): string {
  return `${RDF_OPEN}<rdf:Description rdf:about=""`
    + ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
    + ` Iptc4xmpExt:DigitalSourceType="${sourceType}"/>${RDF_CLOSE}`
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => {
    return sum + part.length
  }, 0))
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function uint32BigEndian(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function uint32LittleEndian(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const body = concat([encoder.encode(type), payload])

  return concat([
    uint32BigEndian(payload.length),
    body,
    uint32BigEndian(crc32(body)),
  ])
}

function createPng(extraChunks: Uint8Array[] = []): Uint8Array {
  const header = concat([
    uint32BigEndian(1),
    uint32BigEndian(1),
    new Uint8Array([8, 6, 0, 0, 0]),
  ])

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    ...extraChunks,
    pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00])),
    pngChunk('IEND', new Uint8Array()),
  ])
}

function pngXmpChunk(
  type: 'iTXt' | 'tEXt',
  text: string | Uint8Array,
  keyword = 'XML:com.adobe.xmp',
): Uint8Array {
  const separator = type === 'iTXt'
    ? new Uint8Array([0, 0, 0, 0, 0])
    : new Uint8Array([0])

  return pngChunk(type, concat([
    encoder.encode(keyword),
    separator,
    typeof text === 'string' ? encoder.encode(text) : text,
  ]))
}

function pngCompressedXmpChunks(): Uint8Array[] {
  const keyword = encoder.encode('XML:com.adobe.xmp')
  const compressedBytes = new Uint8Array([0x78, 0x9c, 0x01, 0x02, 0x03])

  return [
    pngChunk('zTXt', concat([keyword, new Uint8Array([0, 0]), compressedBytes])),
    pngChunk('iTXt', concat([
      keyword,
      new Uint8Array([0, 1, 0, 0, 0]),
      compressedBytes,
    ])),
  ]
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2

  return concat([
    new Uint8Array([0xff, marker, length >> 8, length & 0xff]),
    payload,
  ])
}

function createJpeg(extraSegments: Uint8Array[] = []): Uint8Array {
  const jfif = jpegSegment(0xe0, concat([
    encoder.encode('JFIF\0'),
    new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ]))
  const frame = jpegSegment(
    0xc0,
    new Uint8Array([8, 0, 4, 0, 4, 1, 1, 0x11, 0]),
  )
  const scan = jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0]))

  return concat([
    new Uint8Array([0xff, 0xd8]),
    jfif,
    ...extraSegments,
    frame,
    scan,
    new Uint8Array([0x12, 0x34, 0x56, 0x78]),
    new Uint8Array([0xff, 0xd9]),
  ])
}

function jpegXmpSegment(text: string | Uint8Array): Uint8Array {
  return jpegSegment(0xe1, concat([
    encoder.encode(XMP_HEADER),
    typeof text === 'string' ? encoder.encode(text) : text,
  ]))
}

function jpegExifSegment(): Uint8Array {
  return jpegSegment(0xe1, concat([
    encoder.encode('Exif\0\0'),
    new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
  ]))
}

function jpegIccSegment(): Uint8Array {
  return jpegSegment(0xe2, concat([
    encoder.encode('ICC_PROFILE\0'),
    new Uint8Array([1, 1, 0, 0, 0, 0]),
  ]))
}

function jpegC2paSegment(): Uint8Array {
  return jpegSegment(0xeb, concat([
    encoder.encode('JP'),
    new Uint8Array([0, 1, 0, 0, 0, 1]),
    uint32BigEndian(40),
    encoder.encode('jumb'),
    uint32BigEndian(30),
    encoder.encode('jumd'),
    encoder.encode('c2pa'),
    new Uint8Array(16),
  ]))
}

function webPChunk(type: string, payload: Uint8Array): Uint8Array {
  return concat([
    encoder.encode(type),
    uint32LittleEndian(payload.length),
    payload,
    new Uint8Array(payload.length % 2),
  ])
}

function createRiff(chunks: Uint8Array[]): Uint8Array {
  const body = concat([encoder.encode('WEBP'), ...chunks])

  return concat([encoder.encode('RIFF'), uint32LittleEndian(body.length), body])
}

function vp8lPayload(hasAlpha = false): Uint8Array {
  const header = (299 - 1) | ((203 - 1) << 14) | ((hasAlpha ? 1 : 0) << 28)

  return concat([
    new Uint8Array([0x2f]),
    uint32LittleEndian(header >>> 0),
    new Uint8Array([0x00, 0x11, 0x22]),
  ])
}

function createVp8lWebP(
  extraChunks: Uint8Array[] = [],
  hasAlpha = false,
): Uint8Array {
  return createRiff([webPChunk('VP8L', vp8lPayload(hasAlpha)), ...extraChunks])
}

function createVp8WebP(extraChunks: Uint8Array[] = []): Uint8Array {
  return createRiff([
    webPChunk('VP8 ', new Uint8Array([
      0x50, 0x01, 0x00,
      0x9d, 0x01, 0x2a,
      0x40, 0x01,
      0xc8, 0x00,
      0x00, 0x11, 0x22,
    ])),
    ...extraChunks,
  ])
}

function createVp8xWebP(extraChunks: Uint8Array[] = []): Uint8Array {
  return createRiff([
    webPChunk('VP8X', concat([
      new Uint8Array([0x10, 0, 0, 0]),
      new Uint8Array([0x3f, 0x01, 0x00]),
      new Uint8Array([0xc7, 0x00, 0x00]),
    ])),
    webPChunk('VP8L', vp8lPayload()),
    ...extraChunks,
  ])
}

function createRichVp8xWebP(flags: number): Uint8Array {
  return createRiff([
    webPChunk('VP8X', concat([
      new Uint8Array([flags, 0, 0, 0]),
      new Uint8Array([0x3f, 0x01, 0x00]),
      new Uint8Array([0xc7, 0x00, 0x00]),
    ])),
    webPChunk('ICCP', new Uint8Array([1, 2, 3, 4, 5])),
    webPChunk('VP8L', vp8lPayload()),
    webPChunk('EXIF', new Uint8Array([9, 8, 7])),
  ])
}

function xmpChunk(text: string): Uint8Array {
  return webPChunk('XMP ', encoder.encode(text))
}

function extractPacket(data: Uint8Array): string {
  const text = decoder.decode(data)
  const start = text.indexOf('<?xpacket begin')
  const endMarker = '<?xpacket end="r"?>'
  const end = text.indexOf(endMarker)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return text.slice(start, end + endMarker.length)
}

function readAttribute(packet: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(packet)

  return match ? match[1] ?? null : null
}

function readPngChunks(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const chunks: Array<{
    type: string
    offset: number
    crcIsValid: boolean
  }> = []
  let offset = 8

  while (offset < data.length) {
    const length = view.getUint32(offset)
    const type = decoder.decode(data.subarray(offset + 4, offset + 8))
    const body = data.subarray(offset + 4, offset + 8 + length)

    chunks.push({
      type,
      offset,
      crcIsValid: view.getUint32(offset + 8 + length) === crc32(body),
    })
    offset += 12 + length
  }

  return chunks
}

function readRiffChunks(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const chunks: Array<{ type: string, offset: number, length: number }> = []
  let offset = 12

  while (offset < data.length) {
    const length = view.getUint32(offset + 4, true)

    chunks.push({
      type: decoder.decode(data.subarray(offset, offset + 4)),
      offset,
      length,
    })
    offset += 8 + length + (length % 2)
  }

  expect(offset).toBe(data.length)

  return chunks
}

function readJpegMarkers(data: Uint8Array): number[] {
  const markers: number[] = []
  let offset = 2

  while (offset < data.length) {
    while (data[offset] === 0xff && data[offset + 1] === 0xff) {
      offset += 1
    }

    const marker = data[offset + 1] as number
    const isStandalone = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)

    if (isStandalone) {
      offset += 2
      continue
    }

    markers.push(marker)

    if (marker === 0xda) {
      break
    }

    const length = ((data[offset + 2] as number) << 8)
      | (data[offset + 3] as number)

    offset += 2 + length
  }

  return markers
}

function expectIntactImage(mediaType: MediaType, data: Uint8Array): void {
  expect(() => validateGeneratedImage(data, mediaType)).not.toThrow()

  if (mediaType === 'image/png') {
    expect(readPngChunks(data).every(chunk => chunk.crcIsValid)).toBe(true)
  }

  if (mediaType === 'image/webp') {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    expect(view.getUint32(4, true) + 8).toBe(data.length)
    readRiffChunks(data)
  }

  if (mediaType === 'image/jpeg') {
    expect(readJpegMarkers(data).at(-1)).toBe(0xda)
  }
}

const formats: Array<{
  name: string
  mediaType: MediaType
  create: () => Uint8Array
  withPlainXmp: (text?: string) => Uint8Array
  withOpaqueXmp: () => Uint8Array
  withMarkedXmp: () => Uint8Array
  withOtherSourceTypeXmp: () => Uint8Array
  withC2pa: () => Uint8Array
  withC2paAndPlainXmp: () => Uint8Array
}> = [
  {
    name: 'PNG',
    mediaType: 'image/png',
    create: () => createPng(),
    withPlainXmp: (text = PLAIN_XMP) => createPng([pngXmpChunk('iTXt', text)]),
    withOpaqueXmp: () => createPng([pngXmpChunk('iTXt', OPAQUE_XMP)]),
    withMarkedXmp: () => createPng([pngXmpChunk('iTXt', MARKED_XMP)]),
    withOtherSourceTypeXmp: () => createPng([pngXmpChunk('iTXt', OTHER_XMP)]),
    withC2pa: () => createPng([pngChunk('caBX', new Uint8Array(24))]),
    withC2paAndPlainXmp: () => createPng([
      pngChunk('caBX', new Uint8Array(24)),
      pngXmpChunk('iTXt', PLAIN_XMP),
    ]),
  },
  {
    name: 'JPEG',
    mediaType: 'image/jpeg',
    create: () => createJpeg(),
    withPlainXmp: (text = PLAIN_XMP) => createJpeg([jpegXmpSegment(text)]),
    withOpaqueXmp: () => createJpeg([jpegXmpSegment(OPAQUE_XMP)]),
    withMarkedXmp: () => createJpeg([jpegXmpSegment(MARKED_XMP)]),
    withOtherSourceTypeXmp: () => createJpeg([jpegXmpSegment(OTHER_XMP)]),
    withC2pa: () => createJpeg([jpegC2paSegment()]),
    withC2paAndPlainXmp: () => createJpeg([
      jpegC2paSegment(),
      jpegXmpSegment(PLAIN_XMP),
    ]),
  },
  {
    name: 'WebP',
    mediaType: 'image/webp',
    create: () => createVp8lWebP(),
    withPlainXmp: (text = PLAIN_XMP) => createVp8xWebP([xmpChunk(text)]),
    withOpaqueXmp: () => createVp8xWebP([xmpChunk(OPAQUE_XMP)]),
    withMarkedXmp: () => createVp8xWebP([xmpChunk(MARKED_XMP)]),
    withOtherSourceTypeXmp: () => createVp8xWebP([xmpChunk(OTHER_XMP)]),
    withC2pa: () => createVp8xWebP([
      webPChunk('C2PA', new Uint8Array(24)),
    ]),
    withC2paAndPlainXmp: () => createVp8xWebP([
      webPChunk('C2PA', new Uint8Array(24)),
      xmpChunk(PLAIN_XMP),
    ]),
  },
]

describe('markAiGeneratedImage', () => {
  describe.each(formats)('$name', (format) => {
    it('adds an XMP packet with the trained media source type', () => {
      const original = format.create()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: format.mediaType,
        model: 'grok-imagine-image',
      })
      const packet = extractPacket(result.data)

      expect(result.marking).toBe('added-xmp')
      expect(result.data.length).toBeGreaterThan(original.length)
      expect(readAttribute(packet, 'Iptc4xmpExt:DigitalSourceType'))
        .toBe(TRAINED)
      expect(readAttribute(packet, 'Iptc4xmpExt:AISystemUsed'))
        .toBe('grok-imagine-image')
      expect(packet).not.toContain('CreatorTool')
      expect(packet).toContain('xmlns:Iptc4xmpExt="http://iptc.org/std/')
      expect(packet).not.toContain('xmlns:xmp=')
      expect(packet.startsWith('<?xpacket begin="')).toBe(true)
      expectIntactImage(format.mediaType, result.data)
    })

    it('uses the composite media source type for edits', () => {
      const result = markAiGeneratedImage({
        data: format.create(),
        mediaType: format.mediaType,
        model: 'gpt-image-2',
        isEdit: true,
      })

      expect(result.marking).toBe('added-xmp')
      expect(
        readAttribute(
          extractPacket(result.data),
          'Iptc4xmpExt:DigitalSourceType',
        ),
      ).toBe(COMPOSITE)
    })

    it('is idempotent', () => {
      const first = markAiGeneratedImage({
        data: format.create(),
        mediaType: format.mediaType,
        model: 'm',
      })
      const second = markAiGeneratedImage({
        data: first.data,
        mediaType: format.mediaType,
        model: 'm',
      })

      expect(second.marking).toBe('upstream-xmp')
      expect(second.data).toEqual(first.data)
    })

    it('returns C2PA-signed images byte-identical', () => {
      const original = format.withC2pa()
      const copy = original.slice()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: format.mediaType,
        model: 'm',
      })

      expect(result.marking).toBe('upstream-c2pa')
      expect(result.data).toBe(original)
      expect(result.data).toEqual(copy)
    })

    it('never merges into a file that carries a C2PA manifest', () => {
      const original = format.withC2paAndPlainXmp()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: format.mediaType,
        model: 'm',
      })

      expect(result.marking).toBe('upstream-c2pa')
      expect(result.data).toBe(original)
    })

    it('keeps an existing XMP packet that already has an AI source type',
      () => {
        const original = format.withMarkedXmp()
        const result = markAiGeneratedImage({
          data: original,
          mediaType: format.mediaType,
          model: 'm',
        })

        expect(result.marking).toBe('upstream-xmp')
        expect(result.data).toBe(original)
      })

    it('does not overwrite or merge a non-AI source type', () => {
      const original = format.withOtherSourceTypeXmp()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: format.mediaType,
        model: 'm',
      })

      expect(result.marking).toBe('existing-xmp-unmarked')
      expect(result.data).toBe(original)
    })

    it('leaves an XMP packet without a closing rdf:RDF unchanged', () => {
      const original = format.withOpaqueXmp()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: format.mediaType,
        model: 'm',
      })

      expect(result.marking).toBe('existing-xmp-unmarked')
      expect(result.data).toBe(original)
    })

    it.each([
      ['even', PLAIN_XMP],
      ['odd', `${PLAIN_XMP} `],
    ])('merges our description into an existing XMP packet (%s length)',
      (_label, text) => {
        const original = format.withPlainXmp(text)
        const result = markAiGeneratedImage({
          data: original,
          mediaType: format.mediaType,
          model: 'gpt-image-2',
          isEdit: true,
        })
        const merged = decoder.decode(result.data)
        const descriptionIndex = merged.indexOf('<rdf:Description', 1)
        const ourIndex = merged.indexOf('Iptc4xmpExt:DigitalSourceType')

        expect(result.marking).toBe('merged-xmp')
        expect(merged).toContain('dc:format="image/png"')
        expect(descriptionIndex).toBeGreaterThan(0)
        expect(ourIndex).toBeGreaterThan(merged.indexOf(DC_DESCRIPTION))
        expect(ourIndex).toBeLessThan(merged.indexOf('</rdf:RDF>'))
        expect(readAttribute(merged, 'Iptc4xmpExt:DigitalSourceType'))
          .toBe(COMPOSITE)
        expect(readAttribute(merged, 'Iptc4xmpExt:AISystemUsed'))
          .toBe('gpt-image-2')
        expect(merged).not.toContain('CreatorTool')
        expectIntactImage(format.mediaType, result.data)

        const second = markAiGeneratedImage({
          data: result.data,
          mediaType: format.mediaType,
          model: 'gpt-image-2',
        })

        expect(second.marking).toBe('upstream-xmp')
        expect(second.data).toBe(result.data)
      })

    it('returns the original bytes when marking would exceed maxBytes',
      () => {
        const original = format.create()
        const marked = markAiGeneratedImage({
          data: original,
          mediaType: format.mediaType,
          model: 'm',
        })
        const fits = markAiGeneratedImage({
          data: original,
          mediaType: format.mediaType,
          model: 'm',
          maxBytes: marked.data.length,
        })
        const oversize = markAiGeneratedImage({
          data: original,
          mediaType: format.mediaType,
          model: 'm',
          maxBytes: marked.data.length - 1,
        })

        expect(fits.marking).toBe('added-xmp')
        expect(oversize.marking).toBe('skipped-oversize')
        expect(oversize.data).toBe(original)
      })

    it('applies maxBytes to merged packets and ignores it otherwise', () => {
      const plain = format.withPlainXmp()
      const merged = markAiGeneratedImage({
        data: plain,
        mediaType: format.mediaType,
        model: 'm',
      })
      const oversize = markAiGeneratedImage({
        data: plain,
        mediaType: format.mediaType,
        model: 'm',
        maxBytes: merged.data.length - 1,
      })
      const signed = format.withC2pa()

      expect(oversize.marking).toBe('skipped-oversize')
      expect(oversize.data).toBe(plain)
      expect(markAiGeneratedImage({
        data: signed,
        mediaType: format.mediaType,
        maxBytes: 1,
      }).marking).toBe('upstream-c2pa')
    })

    it('escapes the model id and omits it when absent', () => {
      const escaped = markAiGeneratedImage({
        data: format.create(),
        mediaType: format.mediaType,
        model: 'a&b<c>"d\'e',
      })
      const withoutModel = markAiGeneratedImage({
        data: format.create(),
        mediaType: format.mediaType,
      })

      expect(extractPacket(escaped.data))
        .toContain('Iptc4xmpExt:AISystemUsed="a&amp;b&lt;c&gt;&quot;d&apos;e"')
      expect(extractPacket(withoutModel.data)).not.toContain('AISystemUsed')
      expect(withoutModel.marking).toBe('added-xmp')
    })

    it('replaces control characters and lone surrogates in the model id',
      () => {
        const fffd = String.fromCharCode(0xfffd)
        const model = [
          'a',
          String.fromCharCode(0),
          'b',
          String.fromCharCode(0x1f),
          'c',
          String.fromCharCode(0xd800),
          'd',
          String.fromCharCode(0xffff),
          'e',
        ].join('')
        const result = markAiGeneratedImage({
          data: format.create(),
          mediaType: format.mediaType,
          model,
        })
        const packet = extractPacket(result.data)

        expect(readAttribute(packet, 'Iptc4xmpExt:AISystemUsed'))
          .toBe(`a b c${fffd}d e`)
        expect(packet.includes(String.fromCharCode(0))).toBe(false)
      })

    it('omits a model id that is only whitespace or control characters',
      () => {
        const result = markAiGeneratedImage({
          data: format.create(),
          mediaType: format.mediaType,
          model: String.fromCharCode(9, 32, 10, 0),
        })

        expect(extractPacket(result.data)).not.toContain('AISystemUsed')
      })

    it('truncates an oversized model id', () => {
      const result = markAiGeneratedImage({
        data: format.create(),
        mediaType: format.mediaType,
        model: 'x'.repeat(100_000),
      })

      expect(result.marking).toBe('added-xmp')
      expect(result.data.length).toBeLessThan(5_000)
    })

    it('returns the input untouched for data cut at any offset', () => {
      const original = format.create()
      const offsets = [
        0,
        1,
        2,
        8,
        12,
        20,
        Math.floor(original.length / 3),
        Math.floor(original.length / 2),
        original.length - 7,
        original.length - 1,
      ]

      for (const offset of offsets) {
        const truncated = original.slice(0, offset)
        const result = markAiGeneratedImage({
          data: truncated,
          mediaType: format.mediaType,
          model: 'm',
        })

        expect(result.marking).toBe('unsupported')
        expect(result.data).toBe(truncated)
      }
    })

    it('returns the input untouched for garbage without throwing', () => {
      const garbage = new Uint8Array(64).map((_value, index) => {
        return (index * 37 + 11) & 0xff
      })
      const result = markAiGeneratedImage({
        data: garbage,
        mediaType: format.mediaType,
      })

      expect(result.marking).toBe('unsupported')
      expect(result.data).toBe(garbage)
      expect(markAiGeneratedImage({
        data: new Uint8Array(),
        mediaType: format.mediaType,
      }).marking).toBe('unsupported')
    })
  })

  describe('AI source type detection', () => {
    it.each([
      ['https URI', `Iptc4xmpExt:DigitalSourceType="${TRAINED.replace('http', 'https')}"`],
      ['composite URI', `Iptc4xmpExt:DigitalSourceType="${COMPOSITE}"`],
      ['single quotes', `Iptc4xmpExt:DigitalSourceType='${TRAINED}'`],
    ])('recognises an attribute with a %s', (_label, attribute) => {
      const text = `${RDF_OPEN}<rdf:Description rdf:about="" ${attribute}/>`
        + RDF_CLOSE

      expect(markAiGeneratedImage({
        data: createPng([pngXmpChunk('iTXt', text)]),
        mediaType: 'image/png',
      }).marking).toBe('upstream-xmp')
    })

    it('recognises the element and rdf:resource forms', () => {
      const elementForm = `${RDF_OPEN}<rdf:Description rdf:about="">`
        + `<Iptc4xmpExt:DigitalSourceType>${TRAINED}`
        + '</Iptc4xmpExt:DigitalSourceType></rdf:Description>'
        + RDF_CLOSE
      const resourceForm = `${RDF_OPEN}<rdf:Description rdf:about="">`
        + `<Iptc4xmpExt:DigitalSourceType rdf:resource="${TRAINED}"/>`
        + '</rdf:Description>'
        + RDF_CLOSE

      for (const text of [elementForm, resourceForm]) {
        expect(markAiGeneratedImage({
          data: createPng([pngXmpChunk('iTXt', text)]),
          mediaType: 'image/png',
        }).marking).toBe('upstream-xmp')
      }
    })

    it('does not accept look-alike or foreign source type values', () => {
      const values = [
        `${TRAINED}Fake`,
        `${SOURCE_TYPE_BASE}algorithmicMedia`,
        'https://example.com/digitalsourcetype/trainedAlgorithmicMedia',
        'trainedAlgorithmicMedia',
      ]

      for (const value of values) {
        const original = createPng([
          pngXmpChunk('iTXt', buildSourceTypeXmp(value)),
        ])
        const result = markAiGeneratedImage({
          data: original,
          mediaType: 'image/png',
        })

        expect(result.marking).toBe('existing-xmp-unmarked')
        expect(result.data).toBe(original)
      }
    })
  })

  describe('PNG', () => {
    it('inserts a valid iTXt chunk right after IHDR', () => {
      const result = markAiGeneratedImage({
        data: createPng(),
        mediaType: 'image/png',
        model: 'm',
      })
      const chunks = readPngChunks(result.data)

      expect(chunks.map(chunk => chunk.type))
        .toEqual(['IHDR', 'iTXt', 'IDAT', 'IEND'])
      expect(chunks.every(chunk => chunk.crcIsValid)).toBe(true)
      expect(chunks[1]?.offset).toBe(33)
      expect(
        decoder.decode(
          result.data.subarray(41, 41 + 'XML:com.adobe.xmp'.length),
        ),
      ).toBe('XML:com.adobe.xmp')
    })

    it('rewrites only the XMP chunk when merging into iTXt', () => {
      const result = markAiGeneratedImage({
        data: createPng([
          pngChunk('tIME', new Uint8Array(7)),
          pngXmpChunk('iTXt', PLAIN_XMP),
        ]),
        mediaType: 'image/png',
      })

      expect(result.marking).toBe('merged-xmp')
      expect(readPngChunks(result.data).map(chunk => chunk.type))
        .toEqual(['IHDR', 'tIME', 'iTXt', 'IDAT', 'IEND'])
    })

    it('merges into and reads an uncompressed tEXt XMP packet', () => {
      const plain = createPng([pngXmpChunk('tEXt', PLAIN_XMP)])
      const marked = createPng([pngXmpChunk('tEXt', MARKED_XMP)])
      const merged = markAiGeneratedImage({
        data: plain,
        mediaType: 'image/png',
      })

      expect(merged.marking).toBe('merged-xmp')
      expect(readPngChunks(merged.data).map(chunk => chunk.type))
        .toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND'])
      expectIntactImage('image/png', merged.data)
      expect(markAiGeneratedImage({
        data: marked,
        mediaType: 'image/png',
      }).marking).toBe('upstream-xmp')
    })

    it('leaves compressed XMP packets (zTXt, compressed iTXt) unchanged',
      () => {
        for (const chunk of pngCompressedXmpChunks()) {
          const original = createPng([chunk])
          const result = markAiGeneratedImage({
            data: original,
            mediaType: 'image/png',
          })

          expect(result.marking).toBe('existing-xmp-unmarked')
          expect(result.data).toBe(original)
        }
      })

    it('leaves an XMP packet with invalid UTF-8 unchanged', () => {
      const original = createPng([
        pngXmpChunk('tEXt', new Uint8Array([0xff, 0xfe, 0xfd, 0x3c])),
      ])

      expect(markAiGeneratedImage({
        data: original,
        mediaType: 'image/png',
      }).marking).toBe('existing-xmp-unmarked')
    })

    it('ignores text chunks with another keyword', () => {
      const original = createPng([
        pngXmpChunk('tEXt', 'hello', 'Comment'),
      ])

      expect(markAiGeneratedImage({
        data: original,
        mediaType: 'image/png',
      }).marking).toBe('added-xmp')
    })

    it('does not scan past 79 bytes for a keyword', () => {
      const original = createPng([
        pngChunk('tEXt', concat([
          encoder.encode('k'.repeat(100_000)),
          new Uint8Array([0]),
          encoder.encode('value'),
        ])),
      ])

      expect(markAiGeneratedImage({
        data: original,
        mediaType: 'image/png',
      }).marking).toBe('added-xmp')
    })
  })

  describe('JPEG', () => {
    it('places the APP1 segment after the whole leading APPn run', () => {
      const result = markAiGeneratedImage({
        data: createJpeg([jpegExifSegment(), jpegIccSegment()]),
        mediaType: 'image/jpeg',
        model: 'm',
      })
      const xmpSegmentStart = 2 + 18 + 18 + 2 + 2 + 18

      expect(readJpegMarkers(result.data))
        .toEqual([0xe0, 0xe1, 0xe2, 0xe1, 0xc0, 0xda])

      const xmpLength = ((result.data[xmpSegmentStart + 2] as number) << 8)
        | (result.data[xmpSegmentStart + 3] as number)

      expect(result.data[xmpSegmentStart + 1]).toBe(0xe1)
      expect(result.data[xmpSegmentStart + 2 + xmpLength]).toBe(0xff)
      expect(result.data[xmpSegmentStart + 3 + xmpLength]).toBe(0xc0)
      expect(
        decoder.decode(
          result.data.subarray(
            xmpSegmentStart + 4,
            xmpSegmentStart + 4 + XMP_HEADER.length,
          ),
        ),
      ).toBe(XMP_HEADER)
      expectIntactImage('image/jpeg', result.data)
    })

    it('handles fill bytes and standalone markers between segments', () => {
      const original = createJpeg([
        new Uint8Array([0xff, 0xff]),
        new Uint8Array([0xff, 0x01]),
        new Uint8Array([0xff, 0xd0]),
        jpegExifSegment(),
        new Uint8Array([0xff, 0xff, 0xff]),
        jpegIccSegment(),
      ])
      const result = markAiGeneratedImage({
        data: original,
        mediaType: 'image/jpeg',
        model: 'm',
      })

      expect(result.marking).toBe('added-xmp')
      expectIntactImage('image/jpeg', result.data)
    })

    it('finds XMP and C2PA segments behind fill bytes', () => {
      const fill = new Uint8Array([0xff, 0xff])

      expect(markAiGeneratedImage({
        data: createJpeg([fill, jpegXmpSegment(MARKED_XMP)]),
        mediaType: 'image/jpeg',
      }).marking).toBe('upstream-xmp')
      expect(markAiGeneratedImage({
        data: createJpeg([fill, jpegC2paSegment()]),
        mediaType: 'image/jpeg',
      }).marking).toBe('upstream-c2pa')
    })

    it('does not treat an APP11 segment without c2pa as C2PA', () => {
      const original = createJpeg([
        jpegSegment(0xeb, encoder.encode('JP\0\0 jumb only')),
      ])

      expect(markAiGeneratedImage({
        data: original,
        mediaType: 'image/jpeg',
      }).marking).toBe('added-xmp')
    })

    it('leaves a packet unchanged when the merged segment is too large', () => {
      const filler = ' '.repeat(65_300 - PLAIN_XMP.length)
      const text = PLAIN_XMP.replace(
        '</rdf:RDF>',
        `${filler}</rdf:RDF>`,
      )
      const original = createJpeg([jpegXmpSegment(text)])
      const result = markAiGeneratedImage({
        data: original,
        mediaType: 'image/jpeg',
        model: 'm',
      })

      expect(result.marking).toBe('existing-xmp-unmarked')
      expect(result.data).toBe(original)
    })

    it('rewrites the length of a merged segment', () => {
      const result = markAiGeneratedImage({
        data: createJpeg([jpegXmpSegment(PLAIN_XMP)]),
        mediaType: 'image/jpeg',
        model: 'm',
      })

      expect(result.marking).toBe('merged-xmp')
      expect(readJpegMarkers(result.data)).toEqual([0xe0, 0xe1, 0xc0, 0xda])
      expectIntactImage('image/jpeg', result.data)
    })
  })

  describe('WebP', () => {
    it('wraps a simple VP8L file in VP8X with alpha and canvas size', () => {
      const result = markAiGeneratedImage({
        data: createVp8lWebP([], true),
        mediaType: 'image/webp',
        model: 'm',
      })
      const chunks = readRiffChunks(result.data)

      expect(result.marking).toBe('added-xmp')
      expect(chunks.map(chunk => chunk.type)).toEqual(['VP8X', 'VP8L', 'XMP '])
      expect(chunks[0]?.length).toBe(10)
      expect(result.data[20]).toBe(0x04 | 0x10)
      expect(result.data[21]).toBe(0)
      expect(result.data[22]).toBe(0)
      expect(result.data[23]).toBe(0)
      expect(
        result.data[24]! | (result.data[25]! << 8) | (result.data[26]! << 16),
      ).toBe(299 - 1)
      expect(
        result.data[27]! | (result.data[28]! << 8) | (result.data[29]! << 16),
      ).toBe(203 - 1)
      expectIntactImage('image/webp', result.data)
    })

    it('omits the alpha flag when the VP8L header has no alpha', () => {
      const result = markAiGeneratedImage({
        data: createVp8lWebP(),
        mediaType: 'image/webp',
      })

      expect(result.data[20]).toBe(0x04)
    })

    it('wraps a simple VP8 file using the key-frame dimensions', () => {
      const result = markAiGeneratedImage({
        data: createVp8WebP(),
        mediaType: 'image/webp',
        model: 'm',
      })
      const chunks = readRiffChunks(result.data)

      expect(result.marking).toBe('added-xmp')
      expect(chunks.map(chunk => chunk.type)).toEqual(['VP8X', 'VP8 ', 'XMP '])
      expect(result.data[20]).toBe(0x04)
      expect(
        result.data[24]! | (result.data[25]! << 8) | (result.data[26]! << 16),
      ).toBe(320 - 1)
      expect(
        result.data[27]! | (result.data[28]! << 8) | (result.data[29]! << 16),
      ).toBe(200 - 1)
      expectIntactImage('image/webp', result.data)
    })

    it('appends an XMP chunk to a VP8X file and sets the XMP flag', () => {
      const original = createVp8xWebP()
      const copy = original.slice()
      const result = markAiGeneratedImage({
        data: original,
        mediaType: 'image/webp',
        model: 'm',
      })
      const chunks = readRiffChunks(result.data)

      expect(result.marking).toBe('added-xmp')
      expect(original).toEqual(copy)
      expect(chunks.map(chunk => chunk.type)).toEqual(['VP8X', 'VP8L', 'XMP '])
      expect(result.data[20]).toBe(0x10 | 0x04)
      expect(
        result.data[24]! | (result.data[25]! << 8) | (result.data[26]! << 16),
      ).toBe(0x13f)
      expectIntactImage('image/webp', result.data)
    })

    it('preserves ICC, EXIF and animation flags and their chunks', () => {
      const flags = 0x20 | 0x10 | 0x08 | 0x02
      const original = createRichVp8xWebP(flags)
      const result = markAiGeneratedImage({
        data: original,
        mediaType: 'image/webp',
        model: 'm',
      })
      const chunks = readRiffChunks(result.data)
      const originalChunks = readRiffChunks(original)

      expect(result.marking).toBe('added-xmp')
      expect(result.data[20]).toBe(flags | 0x04)
      expect(chunks.map(chunk => chunk.type))
        .toEqual(['VP8X', 'ICCP', 'VP8L', 'EXIF', 'XMP '])
      expect(result.data.subarray(21, original.length))
        .toEqual(original.subarray(21))
      expect(chunks.slice(0, 4).map(chunk => chunk.length))
        .toEqual(originalChunks.map(chunk => chunk.length))
      expectIntactImage('image/webp', result.data)
    })

    it('pads an odd-sized XMP chunk with one zero byte', () => {
      const results = ['a', 'ab'].map((model) => {
        return markAiGeneratedImage({
          data: createVp8xWebP(),
          mediaType: 'image/webp',
          model,
        })
      })

      for (const result of results) {
        const xmpChunkInfo = readRiffChunks(result.data).at(-1)!

        expect(xmpChunkInfo.type).toBe('XMP ')
        expect(
          xmpChunkInfo.offset + 8 + xmpChunkInfo.length
          + (xmpChunkInfo.length % 2),
        ).toBe(result.data.length)
      }

      const lengths = results.map((result) => {
        return readRiffChunks(result.data).at(-1)!.length
      })

      expect(lengths[0]! % 2).not.toBe(lengths[1]! % 2)
    })

    it('merges into an XMP chunk in the middle of the file', () => {
      const original = createVp8xWebP([
        xmpChunk(PLAIN_XMP),
        webPChunk('EXIF', new Uint8Array([9, 8, 7])),
      ])
      const result = markAiGeneratedImage({
        data: original,
        mediaType: 'image/webp',
        model: 'm',
      })

      expect(result.marking).toBe('merged-xmp')
      expect(readRiffChunks(result.data).map(chunk => chunk.type))
        .toEqual(['VP8X', 'VP8L', 'XMP ', 'EXIF'])
      expectIntactImage('image/webp', result.data)
    })

    it('treats a simple file with extra chunks as an unknown layout', () => {
      const original = createVp8lWebP([
        webPChunk('ZZZZ', new Uint8Array([1, 2, 3])),
      ])

      expect(markAiGeneratedImage({
        data: original,
        mediaType: 'image/webp',
      })).toEqual({ data: original, marking: 'unsupported' })
    })
  })

  it('returns unsupported when the bytes do not match the media type', () => {
    const png = createPng()

    expect(markAiGeneratedImage({
      data: png,
      mediaType: 'image/jpeg',
    })).toEqual({ data: png, marking: 'unsupported' })
  })
})
