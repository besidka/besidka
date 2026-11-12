import { Inflate } from 'fflate'
import { VALIDATION_LIMITS } from '../validate/rules.ts'
import { XmlError, decodeXmlBytes, parseXml } from '../validate/xml.ts'
import type { ParseXmlOptions, XmlEvent } from '../validate/xml.ts'
import { readZipDirectory } from '../validate/zip.ts'
import type { ZipEntry } from '../validate/zip.ts'
import { TRUNCATION_MARKER } from './types.ts'
import type {
  ExtractLimits,
  ExtractStats,
  TruncationReason,
} from './types.ts'

export class ExtractError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

class InflateStop extends Error {}

export interface OfficePackage {
  bytes: Uint8Array
  entries: Map<string, ZipEntry>
  limits: ExtractLimits
  stats: ExtractStats
}

export interface Relationship {
  id: string
  type: string
  target: string
  isExternal: boolean
}

export interface ScanOutcome {
  enough: boolean
  cut: boolean
}

export type BlockKind = 'block' | 'list' | 'line'

export interface ExtractionOutput {
  sink: TextSink
  hasContent: boolean
}

const INITIAL_PART_BYTES = 1024 * 1024
const WINDOW_BYTES = 1024 * 1024
const PART_GROWTH_FACTOR = 4
const HIGH_SURROGATE_START = 0xD800
const HIGH_SURROGATE_END = 0xDBFF
const LOW_SURROGATE_START = 0xDC00
const LOW_SURROGATE_END = 0xDFFF

function characterWidth(
  text: string,
  index: number,
): { bytes: number, units: number } {
  const code = text.charCodeAt(index)

  if (code < 0x80) {
    return { bytes: 1, units: 1 }
  }

  if (code < 0x800) {
    return { bytes: 2, units: 1 }
  }

  if (code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END) {
    const next = text.charCodeAt(index + 1)

    if (next >= LOW_SURROGATE_START && next <= LOW_SURROGATE_END) {
      return { bytes: 4, units: 2 }
    }
  }

  return { bytes: 3, units: 1 }
}

export function utf8Length(text: string): number {
  let bytes = 0
  let index = 0

  while (index < text.length) {
    const width = characterWidth(text, index)

    bytes += width.bytes
    index += width.units
  }

  return bytes
}

export function cutToUtf8Bytes(text: string, maxBytes: number): string {
  let bytes = 0
  let index = 0

  while (index < text.length) {
    const width = characterWidth(text, index)

    if (bytes + width.bytes > maxBytes) {
      break
    }

    bytes += width.bytes
    index += width.units
  }

  return text.slice(0, index)
}

export function cutToCharacters(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text
  }

  const code = text.charCodeAt(maxCharacters - 1)
  const endsOnHighSurrogate = code >= HIGH_SURROGATE_START
    && code <= HIGH_SURROGATE_END
  const end = endsOnHighSurrogate ? maxCharacters - 1 : maxCharacters

  return `${text.slice(0, end)}…`
}

/**
 * Collects Markdown blocks under a byte budget counted in UTF-8. The text
 * limit marker is reserved up front, so the finished string never exceeds
 * the limit. A block that does not fit is cut on a code point boundary, a
 * line that does not fit is dropped whole, and every later write is refused.
 */
export class TextSink {
  isFull = false

  private readonly parts: string[] = []
  private readonly budget: number
  private bytes = 0
  private lastKind: BlockKind | null = null

  constructor(maxBytes: number) {
    this.budget = maxBytes - utf8Length(TRUNCATION_MARKER) - 2
  }

  add(text: string, kind: BlockKind = 'block'): boolean {
    if (this.isFull) {
      return false
    }

    if (text.length === 0) {
      return true
    }

    const separator = this.separatorFor(kind)
    const total = separator.length + utf8Length(text)

    if (this.bytes + total <= this.budget) {
      this.parts.push(separator, text)
      this.bytes += total
      this.lastKind = kind

      return true
    }

    this.isFull = true

    if (kind !== 'line') {
      const room = this.budget - this.bytes - separator.length
      const cut = room > 0 ? cutToUtf8Bytes(text, room) : ''

      if (cut.length > 0) {
        this.parts.push(separator, cut)
        this.bytes += separator.length + utf8Length(cut)
      }
    }

    return false
  }

  toString(): string {
    const text = this.parts.join('')

    return this.isFull ? `${text}\n\n${TRUNCATION_MARKER}` : text
  }

  private separatorFor(kind: BlockKind): string {
    if (this.lastKind === null) {
      return ''
    }

    if (kind === 'line' || (kind === 'list' && this.lastKind === 'list')) {
      return '\n'
    }

    return '\n\n'
  }
}

export function addTruncation(
  stats: ExtractStats,
  reason: TruncationReason,
): void {
  if (!stats.truncations.includes(reason)) {
    stats.truncations.push(reason)
  }
}

export function openPackage(
  bytes: Uint8Array,
  limits: ExtractLimits,
  stats: ExtractStats,
): OfficePackage {
  const result = readZipDirectory(bytes, {
    entriesMax: limits.zipEntriesMax,
    entryBytesMax: limits.zipEntryBytesMax,
    totalBytesMax: limits.zipTotalBytesMax,
    ratioMax: limits.zipRatioMax,
    ratioMinBytes: limits.zipRatioMinBytes,
  })

  if (!result.ok) {
    throw new ExtractError(result.code, result.detail)
  }

  const entries = new Map<string, ZipEntry>()

  for (const entry of result.directory.entries) {
    entries.set(entry.name.toLowerCase(), entry)
  }

  stats.entries = entries.size

  return { bytes, entries, limits, stats }
}

export function findEntry(
  pkg: OfficePackage,
  name: string,
): ZipEntry | null {
  return pkg.entries.get(name.toLowerCase()) ?? null
}

function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
  let index = bytes.length - 1
  let continuationBytes = 0

  while (
    index >= 0
    && continuationBytes < 3
    && ((bytes[index] as number) & 0xC0) === 0x80
  ) {
    index -= 1
    continuationBytes += 1
  }

  if (index < 0) {
    return bytes
  }

  const lead = bytes[index] as number
  let expected = 1

  if (lead >= 0xF0) {
    expected = 4
  } else if (lead >= 0xE0) {
    expected = 3
  } else if (lead >= 0xC0) {
    expected = 2
  }

  return expected > continuationBytes + 1 ? bytes.subarray(0, index) : bytes
}

function readPrefix(
  archive: Uint8Array,
  entry: ZipEntry,
  wantedBytes: number,
): { data: Uint8Array, complete: boolean } {
  const capacity = Math.min(wantedBytes, entry.uncompressedSize)
  const complete = capacity >= entry.uncompressedSize
  const raw = archive.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  )

  if (entry.method === 0) {
    return { data: raw.subarray(0, capacity), complete }
  }

  const output = new Uint8Array(capacity)
  let written = 0
  let overflowed = false

  try {
    const inflater = new Inflate((chunk) => {
      const room = capacity - written

      if (chunk.length > room) {
        output.set(chunk.subarray(0, room), written)
        written += room
        overflowed = true

        throw new InflateStop()
      }

      output.set(chunk, written)
      written += chunk.length
    })
    const slice = VALIDATION_LIMITS.inflateSliceBytes

    for (let start = 0; start < raw.length; start += slice) {
      const end = Math.min(start + slice, raw.length)

      inflater.push(raw.subarray(start, end), end === raw.length)
    }

    if (raw.length === 0) {
      inflater.push(new Uint8Array(0), true)
    }
  } catch (exception) {
    if (!(exception instanceof InflateStop)) {
      throw new ExtractError(
        'zip_corrupt',
        `Entry ${entry.name.slice(0, 80)} is not valid deflate data`,
      )
    }
  }

  if (overflowed) {
    if (complete) {
      throw new ExtractError(
        'zip_size_mismatch',
        `Entry ${entry.name.slice(0, 80)} inflates beyond its declared size`,
      )
    }

    return { data: output, complete: false }
  }

  if (written !== entry.uncompressedSize) {
    throw new ExtractError(
      'zip_size_mismatch',
      `Entry ${entry.name.slice(0, 80)} inflated to ${written}`,
    )
  }

  return { data: output, complete: true }
}

function* tolerantEvents(
  text: string,
  isPrefix: boolean,
  options: ParseXmlOptions,
): Generator<XmlEvent> {
  try {
    yield* parseXml(text, options)
  } catch (exception) {
    const isCutOff = isPrefix
      && exception instanceof XmlError
      && exception.code === 'xml_malformed'

    if (!isCutOff) {
      throw exception
    }
  }
}

/**
 * Feeds the XML events of one part to `consume`, inflating only a prefix.
 * The prefix starts small and grows fourfold until `consume` reports it has
 * seen enough, the part ends or the part cap is reached, so a worksheet that
 * needs 1000 rows never inflates its 40 MB tail. `consume` is called again
 * from the first event on every growth, so it must reset its own state.
 */
export function scanPart(
  pkg: OfficePackage,
  entry: ZipEntry,
  consume: (events: Iterable<XmlEvent>) => boolean,
  options: ParseXmlOptions = {},
): ScanOutcome {
  const cap = Math.min(pkg.limits.partBytesMax, entry.uncompressedSize)
  let wanted = Math.min(INITIAL_PART_BYTES, cap)

  for (;;) {
    const prefix = readPrefix(pkg.bytes, entry, wanted)
    const text = decodeXmlBytes(
      prefix.complete ? prefix.data : trimIncompleteUtf8(prefix.data),
    )
    const enough = consume(tolerantEvents(text, !prefix.complete, options))

    if (enough || prefix.complete) {
      return { enough, cut: false }
    }

    if (wanted >= cap) {
      return { enough: false, cut: true }
    }

    wanted = Math.min(wanted * PART_GROWTH_FACTOR, cap)
  }
}

function boundaryBytes(boundary: string): number[] {
  return Array.from(boundary, character => character.charCodeAt(0))
}

function indexAfterBoundary(
  data: Uint8Array,
  boundary: number[],
  from: number,
): number {
  const last = data.length - boundary.length

  for (let start = Math.max(from, 0); start <= last; start += 1) {
    const isMatch = boundary.every((value, offset) => {
      return data[start + offset] === value
    })

    if (isMatch) {
      return start + boundary.length
    }
  }

  return -1
}

function lastIndexAfterBoundary(
  data: Uint8Array,
  boundary: number[],
  notBefore: number,
): number {
  for (
    let start = data.length - boundary.length;
    start >= notBefore;
    start -= 1
  ) {
    const isMatch = boundary.every((value, offset) => {
      return data[start + offset] === value
    })

    if (isMatch) {
      return start + boundary.length
    }
  }

  return -1
}

/**
 * Like `scanPart`, for a part made of many small records such as
 * `sharedStrings.xml`: the prefix is decoded and parsed one window at a time,
 * each window cut right after the ASCII `boundary` that ends a record, so
 * only one window of text is alive instead of the whole prefix. `consume`
 * gets the raw window text, so it can skip records it does not need without
 * tokenizing them, and runs once per window; it must reset its own state when
 * `isFirstWindow` is set, because a larger prefix replays every window from
 * the start.
 */
export function scanPartWindows(
  pkg: OfficePackage,
  entry: ZipEntry,
  boundary: string,
  consume: (text: string, isFirstWindow: boolean) => boolean,
): ScanOutcome {
  const cap = Math.min(pkg.limits.partBytesMax, entry.uncompressedSize)
  const marker = boundaryBytes(boundary)
  let wanted = Math.min(INITIAL_PART_BYTES, cap)

  for (;;) {
    const prefix = readPrefix(pkg.bytes, entry, wanted)
    const { data } = prefix
    let start = 0
    let enough = false

    while (start < data.length && !enough) {
      let end = Math.min(start + WINDOW_BYTES, data.length)

      if (prefix.complete && end >= data.length) {
        end = data.length
      } else if (end >= data.length) {
        end = lastIndexAfterBoundary(data, marker, start)
      } else {
        end = indexAfterBoundary(data, marker, end - marker.length)

        if (end === -1 && prefix.complete) {
          end = data.length
        }
      }

      if (end <= start) {
        break
      }

      const text = decodeXmlBytes(data.subarray(start, end))

      enough = consume(text, start === 0)
      start = end
    }

    if (enough || (prefix.complete && start >= data.length)) {
      return { enough, cut: false }
    }

    if (wanted >= cap) {
      return { enough: false, cut: true }
    }

    wanted = Math.min(wanted * PART_GROWTH_FACTOR, cap)
  }
}

export function resolvePartPath(basePart: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1)
  }

  const segments = basePart.split('/').slice(0, -1)

  for (const segment of target.split('/')) {
    if (segment === '..') {
      segments.pop()
    } else if (segment !== '.' && segment !== '') {
      segments.push(segment)
    }
  }

  return segments.join('/')
}

export function relationshipsPartFor(partName: string): string {
  const slash = partName.lastIndexOf('/')
  const directory = slash === -1 ? '' : partName.slice(0, slash + 1)
  const file = slash === -1 ? partName : partName.slice(slash + 1)

  return `${directory}_rels/${file}.rels`
}

export function readRelationships(
  pkg: OfficePackage,
  partName: string,
): Relationship[] {
  const entry = findEntry(pkg, relationshipsPartFor(partName))

  if (!entry) {
    return []
  }

  const relationships: Relationship[] = []

  scanPart(pkg, entry, (events) => {
    relationships.length = 0

    for (const event of events) {
      if (event.type === 'start' && event.name === 'Relationship') {
        const { Id, Type, Target, TargetMode } = event.attributes
        const isExternal = TargetMode === 'External'

        relationships.push({
          id: Id ?? '',
          type: Type ?? '',
          target: isExternal
            ? (Target ?? '')
            : resolvePartPath(partName, Target ?? ''),
          isExternal,
        })
      }
    }

    return false
  })

  return relationships
}

export function relationshipIdOf(
  attributes: Record<string, string>,
): string | null {
  for (const [name, value] of Object.entries(attributes)) {
    if (name.endsWith(':id')) {
      return value
    }
  }

  return null
}

function escapeTableCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function renderMarkdownTable(rows: string[][]): string {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)

  if (width === 0) {
    return ''
  }

  const lines = rows.map((row) => {
    const cells = Array.from({ length: width }, (_cell, index) => {
      return escapeTableCell(row[index] ?? '')
    })

    return `| ${cells.join(' | ')} |`
  })
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`

  return [lines[0], separator, ...lines.slice(1)].join('\n')
}
