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

export interface ExtractBudget {
  inflatedBytes: number
  events: number
}

export interface OfficePackage {
  bytes: Uint8Array
  entries: Map<string, ZipEntry>
  limits: ExtractLimits
  stats: ExtractStats
  budget: ExtractBudget
  mainPart: string
  relationshipCache: Map<string, Relationship[]>
}

export interface TableOptions {
  rowsMax: number
  columnsMax: number
  cellCharsMax: number
  maxBytes: number
}

export interface RenderedTable {
  text: string
  reasons: TruncationReason[]
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
export const ATTRIBUTES_MAX = 128
const BUDGET_EXCEEDED_CODE = 'extract_budget_exceeded'
const GREATER_THAN = 0x3E
const LESS_THAN = 0x3C
const SLASH = 0x2F
const COLON = 0x3A
const MAX_PREFIX_BYTES = 64
const OFFICE_DOCUMENT_TYPE_SUFFIX = '/officeDocument'
const ID_LENGTH_MAX = 64
const TYPE_LENGTH_MAX = 256
const TARGET_LENGTH_MAX = 512
const RELATIONSHIPS_PER_PART_MAX = 1000
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

  get remainingBytes(): number {
    return this.isFull ? 0 : Math.max(this.budget - this.bytes, 0)
  }

  addBlankLines(count: number): void {
    if (this.isFull || this.lastKind === null) {
      return
    }

    const room = Math.max(Math.min(count, this.budget - this.bytes), 0)

    for (let index = 0; index < room; index += 1) {
      this.parts.push('\n', '')
    }

    this.bytes += room
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

  return {
    bytes,
    entries,
    limits,
    stats,
    budget: { inflatedBytes: 0, events: 0 },
    mainPart: '',
    relationshipCache: new Map(),
  }
}

export function findEntry(
  officePackage: OfficePackage,
  name: string,
): ZipEntry | null {
  return officePackage.entries.get(name.toLowerCase()) ?? null
}

function budgetExceeded(what: string): ExtractError {
  return new ExtractError(
    BUDGET_EXCEEDED_CODE,
    `The extraction budget for ${what} was used up`,
  )
}

export function chargeEvent(officePackage: OfficePackage): void {
  const { budget, limits } = officePackage

  budget.events += 1

  if (budget.events > limits.eventsMax) {
    throw budgetExceeded('parser events')
  }
}

function chargeInflated(officePackage: OfficePackage, bytes: number): void {
  const { budget, limits } = officePackage

  budget.inflatedBytes += bytes

  if (budget.inflatedBytes > limits.inflatedBytesMax) {
    throw budgetExceeded('inflated bytes')
  }
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

/**
 * Inflates one ZIP entry on demand and keeps what it already inflated, so a
 * larger prefix continues where the previous one stopped instead of reading
 * the part from the start. Output beyond the requested prefix, which arrives
 * because the inflater emits whole blocks, is held back until the next read.
 * Every inflated byte is charged to the package budget once.
 */
class PartReader {
  private readonly officePackage: OfficePackage
  private readonly entry: ZipEntry
  private readonly raw: Uint8Array
  private inflater: Inflate | null = null
  private buffer = new Uint8Array(0)
  private written = 0
  private produced = 0
  private charged = 0
  private rawOffset = 0
  private isRawFinished = false
  private pending: Uint8Array[] = []

  constructor(officePackage: OfficePackage, entry: ZipEntry) {
    this.officePackage = officePackage
    this.entry = entry
    this.raw = officePackage.bytes.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize,
    )
  }

  read(wantedBytes: number): { data: Uint8Array, complete: boolean } {
    const { entry } = this
    const capacity = Math.min(wantedBytes, entry.uncompressedSize)
    const complete = capacity >= entry.uncompressedSize

    if (entry.method === 0) {
      chargeInflated(this.officePackage, Math.max(capacity - this.charged, 0))
      this.charged = Math.max(capacity, this.charged)

      return { data: this.raw.subarray(0, capacity), complete }
    }

    this.growBuffer(capacity)
    this.inflate(capacity, complete)

    return { data: this.buffer.subarray(0, this.written), complete }
  }

  /**
   * Reads and decodes a prefix. Once the whole part is decoded the inflated
   * bytes are dropped before the caller parses the text, so the buffer and
   * the string are not alive together.
   */
  readText(wantedBytes: number): { text: string, isComplete: boolean } {
    const prefix = this.read(wantedBytes)
    const text = decodeXmlBytes(
      prefix.complete ? prefix.data : trimIncompleteUtf8(prefix.data),
    )

    if (prefix.complete) {
      this.buffer = new Uint8Array(0)
      this.pending = []
      this.written = 0
    }

    return { text, isComplete: prefix.complete }
  }

  private mismatch(inflatedBytes: number): ExtractError {
    return new ExtractError(
      'zip_size_mismatch',
      `Entry ${this.entry.name.slice(0, 80)} inflated to ${inflatedBytes}`,
    )
  }

  private growBuffer(capacity: number): void {
    if (this.buffer.length >= capacity) {
      return
    }

    const grown = new Uint8Array(capacity)

    grown.set(this.buffer.subarray(0, this.written))
    this.buffer = grown

    const queued = this.pending

    this.pending = []

    for (const chunk of queued) {
      this.store(chunk)
    }
  }

  private store(chunk: Uint8Array): void {
    const room = this.buffer.length - this.written
    const taken = Math.min(room, chunk.length)

    if (taken > 0) {
      this.buffer.set(chunk.subarray(0, taken), this.written)
      this.written += taken
    }

    if (taken < chunk.length) {
      this.pending.push(chunk.slice(taken))
    }
  }

  private accept(chunk: Uint8Array): void {
    this.produced += chunk.length
    chargeInflated(this.officePackage, chunk.length)
    this.store(chunk)
  }

  private inflate(capacity: number, complete: boolean): void {
    const { entry, raw } = this
    const inflater = this.inflater ?? new Inflate((chunk) => {
      this.accept(chunk)
    })
    const slice = VALIDATION_LIMITS.inflateSliceBytes

    this.inflater = inflater

    try {
      while (!this.isRawFinished && (complete || this.produced < capacity)) {
        const end = Math.min(this.rawOffset + slice, raw.length)
        const isLast = end === raw.length

        inflater.push(raw.subarray(this.rawOffset, end), isLast)
        this.rawOffset = end
        this.isRawFinished = isLast

        if (this.produced > entry.uncompressedSize) {
          throw this.mismatch(this.produced)
        }
      }
    } catch (exception) {
      if (exception instanceof ExtractError) {
        throw exception
      }

      throw new ExtractError(
        'zip_corrupt',
        `Entry ${entry.name.slice(0, 80)} is not valid deflate data`,
      )
    }

    if (this.isRawFinished && this.produced !== entry.uncompressedSize) {
      throw this.mismatch(this.produced)
    }
  }
}

function* tolerantEvents(
  officePackage: OfficePackage,
  text: string,
  isPrefix: boolean,
  options: ParseXmlOptions,
): Generator<XmlEvent> {
  try {
    for (const event of parseXml(text, options)) {
      chargeEvent(officePackage)

      yield event
    }
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
  officePackage: OfficePackage,
  entry: ZipEntry,
  consume: (events: Iterable<XmlEvent>) => boolean,
  options: ParseXmlOptions = {},
): ScanOutcome {
  const { partBytesMax } = officePackage.limits
  const cap = Math.min(partBytesMax, entry.uncompressedSize)
  const reader = new PartReader(officePackage, entry)
  const parseOptions: ParseXmlOptions = {
    attributesMax: ATTRIBUTES_MAX,
    ...options,
  }
  let wanted = Math.min(INITIAL_PART_BYTES, cap)

  for (;;) {
    const { text, isComplete } = reader.readText(wanted)
    const enough = consume(
      tolerantEvents(officePackage, text, !isComplete, parseOptions),
    )

    if (enough || isComplete) {
      return { enough, cut: false }
    }

    if (wanted >= cap) {
      return { enough: false, cut: true }
    }

    wanted = Math.min(wanted * PART_GROWTH_FACTOR, cap)
  }
}

function isNameByte(byte: number | undefined): boolean {
  return byte !== undefined && (
    (byte >= 0x30 && byte <= 0x39)
    || (byte >= 0x41 && byte <= 0x5A)
    || (byte >= 0x61 && byte <= 0x7A)
    || byte === 0x5F
    || byte === 0x2D
    || byte === 0x2E
  )
}

/**
 * True when `data[greaterThan]` closes an end tag of `name`, with or without a
 * namespace prefix: `</si>` and `</x:si>`, but not `<x:si>` or `</xsi>`.
 */
function closesElement(
  data: Uint8Array,
  greaterThan: number,
  name: number[],
): boolean {
  const nameStart = greaterThan - name.length

  if (nameStart < 2) {
    return false
  }

  for (let offset = 0; offset < name.length; offset += 1) {
    if (data[nameStart + offset] !== name[offset]) {
      return false
    }
  }

  const before = data[nameStart - 1]

  if (before === SLASH) {
    return data[nameStart - 2] === LESS_THAN
  }

  if (before !== COLON) {
    return false
  }

  let cursor = nameStart - 2
  let steps = 0

  while (isNameByte(data[cursor]) && steps < MAX_PREFIX_BYTES) {
    cursor -= 1
    steps += 1
  }

  return data[cursor] === SLASH && data[cursor - 1] === LESS_THAN
}

function indexAfterClosing(
  data: Uint8Array,
  name: number[],
  from: number,
): number {
  let greaterThan = data.indexOf(GREATER_THAN, Math.max(from, 0))

  while (greaterThan !== -1) {
    if (closesElement(data, greaterThan, name)) {
      return greaterThan + 1
    }

    greaterThan = data.indexOf(GREATER_THAN, greaterThan + 1)
  }

  return -1
}

function lastIndexAfterClosing(
  data: Uint8Array,
  name: number[],
  notBefore: number,
): number {
  let greaterThan = data.lastIndexOf(GREATER_THAN)

  while (greaterThan >= notBefore) {
    if (closesElement(data, greaterThan, name)) {
      return greaterThan + 1
    }

    greaterThan = data.lastIndexOf(GREATER_THAN, greaterThan - 1)
  }

  return -1
}

/**
 * Like `scanPart`, for a part made of many small records such as
 * `sharedStrings.xml`, but a pull reader: each call to `next` decodes one
 * window of about 1 MiB, cut right after the end tag of the `record` element
 * (any namespace prefix), and the next call continues after it, even when the
 * prefix has to grow. Only one window of text is alive at a time. `rewind`
 * starts over from the first window without inflating anything again.
 */
export class WindowedPart {
  isCut = false

  private readonly reader: PartReader
  private readonly cap: number
  private readonly closingName: number[]
  private wanted: number
  private data: Uint8Array = new Uint8Array(0)
  private isComplete = false
  private isLoaded = false
  private offset = 0

  constructor(
    officePackage: OfficePackage,
    entry: ZipEntry,
    record: string,
  ) {
    this.reader = new PartReader(officePackage, entry)
    this.cap = Math.min(
      officePackage.limits.partBytesMax,
      entry.uncompressedSize,
    )
    this.closingName = Array.from(record, (character) => {
      return character.charCodeAt(0)
    })
    this.wanted = Math.min(INITIAL_PART_BYTES, this.cap)
  }

  rewind(): void {
    this.offset = 0
    this.isCut = false
  }

  next(): string | null {
    for (;;) {
      if (!this.isLoaded) {
        this.load()
      }

      const end = this.windowEnd()

      if (end > this.offset) {
        const text = decodeXmlBytes(this.data.subarray(this.offset, end))

        this.offset = end

        return text
      }

      if (this.offset >= this.data.length && this.isComplete) {
        return null
      }

      if (this.wanted >= this.cap) {
        this.isCut = !this.isComplete

        return null
      }

      this.wanted = Math.min(this.wanted * PART_GROWTH_FACTOR, this.cap)
      this.load()
    }
  }

  private load(): void {
    const prefix = this.reader.read(this.wanted)

    this.data = prefix.data
    this.isComplete = prefix.complete
    this.isLoaded = true
  }

  private windowEnd(): number {
    const { data, isComplete, offset, closingName } = this
    const nominalEnd = Math.min(offset + WINDOW_BYTES, data.length)

    if (nominalEnd >= data.length) {
      return isComplete
        ? data.length
        : lastIndexAfterClosing(data, closingName, offset)
    }

    const found = indexAfterClosing(data, closingName, nominalEnd - 1)

    if (found !== -1) {
      return found
    }

    return isComplete
      ? data.length
      : lastIndexAfterClosing(data, closingName, offset)
  }
}

export function meterEvents(
  officePackage: OfficePackage,
  events: Iterable<XmlEvent>,
): Iterable<XmlEvent> {
  return {
    * [Symbol.iterator]() {
      for (const event of events) {
        chargeEvent(officePackage)

        yield event
      }
    },
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
  officePackage: OfficePackage,
  partName: string,
): Relationship[] {
  const isReused = partName === '' || partName === officePackage.mainPart
  const cacheKey = partName.toLowerCase()
  const cached = isReused
    ? officePackage.relationshipCache.get(cacheKey)
    : undefined

  if (cached) {
    return cached
  }

  const entry = findEntry(officePackage, relationshipsPartFor(partName))
  const relationships: Relationship[] = []

  if (isReused) {
    officePackage.relationshipCache.set(cacheKey, relationships)
  }

  if (!entry) {
    return relationships
  }

  scanPart(officePackage, entry, (events) => {
    relationships.length = 0

    for (const event of events) {
      if (event.type !== 'start' || event.name !== 'Relationship') {
        continue
      }

      if (relationships.length >= RELATIONSHIPS_PER_PART_MAX) {
        break
      }

      const { Id, Type, Target, TargetMode } = event.attributes
      const isExternal = TargetMode === 'External'

      const target = (Target ?? '').slice(0, TARGET_LENGTH_MAX)

      relationships.push({
        id: shortId(Id ?? ''),
        type: (Type ?? '').slice(0, TYPE_LENGTH_MAX),
        target: isExternal ? target : resolvePartPath(partName, target),
        isExternal,
      })
    }

    return false
  })

  return relationships
}

export function resolveMainPart(
  officePackage: OfficePackage,
  fallbackPart: string,
): string {
  const declared = readRelationships(officePackage, '').find((relationship) => {
    return !relationship.isExternal
      && relationship.type.endsWith(OFFICE_DOCUMENT_TYPE_SUFFIX)
  })

  if (declared && findEntry(officePackage, declared.target)) {
    return declared.target
  }

  return fallbackPart
}

export function relationshipIdOf(
  attributes: Record<string, string>,
): string | null {
  for (const [name, value] of Object.entries(attributes)) {
    if (name.endsWith(':id')) {
      return shortId(value)
    }
  }

  return null
}

/**
 * Keeps an identifier short, so a stored or compared name cannot cost more
 * than a few bytes however large the attribute it came from was.
 */
export function shortId(value: string): string {
  return value.length > ID_LENGTH_MAX ? value.slice(0, ID_LENGTH_MAX) : value
}

export function appendText(
  target: { parts: string[], length: number },
  text: string,
  maxLength: number,
): void {
  if (target.length >= maxLength) {
    return
  }

  target.parts.push(text)
  target.length += text.length
}

function isLineTerminator(code: number): boolean {
  return code === 0x0A || code === 0x0D || code === 0x2028 || code === 0x2029
}

/**
 * The characters the `\s` class of a regular expression matches.
 */
export function isWhitespaceCode(code: number): boolean {
  return (code >= 0x09 && code <= 0x0D)
    || code === 0x20
    || code === 0xA0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200A)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202F
    || code === 0x205F
    || code === 0x3000
    || code === 0xFEFF
}

/**
 * Removes spaces and tabs before every line end and at the end of the text,
 * in one pass (the equivalent regular expression is quadratic on a long run
 * of spaces).
 */
export function trimLineEnds(text: string): string {
  const pieces: string[] = []
  let segmentStart = 0
  let runStart = -1

  for (let index = 0; index <= text.length; index += 1) {
    const code = index < text.length ? text.charCodeAt(index) : -1

    if (code === 0x20 || code === 0x09) {
      if (runStart === -1) {
        runStart = index
      }

      continue
    }

    const isBoundary = code === -1 || isLineTerminator(code)

    if (isBoundary && runStart !== -1) {
      pieces.push(text.slice(segmentStart, runStart))
      segmentStart = index
    }

    runStart = -1
  }

  pieces.push(text.slice(segmentStart))

  return pieces.join('')
}

/**
 * Replaces every run of whitespace that contains a line feed with one space,
 * in one pass.
 */
export function collapseLineBreaks(text: string): string {
  const pieces: string[] = []
  let segmentStart = 0
  let index = 0

  while (index < text.length) {
    if (!isWhitespaceCode(text.charCodeAt(index))) {
      index += 1
      continue
    }

    const runStart = index
    let hasLineFeed = false

    while (index < text.length && isWhitespaceCode(text.charCodeAt(index))) {
      hasLineFeed = hasLineFeed || text.charCodeAt(index) === 0x0A
      index += 1
    }

    if (hasLineFeed) {
      pieces.push(text.slice(segmentStart, runStart), ' ')
      segmentStart = index
    }
  }

  pieces.push(text.slice(segmentStart))

  return pieces.join('')
}

/**
 * Appends one table cell to a row that never grows past `columnsMax`, and
 * pads the columns a merged cell spans with empty cells up to that limit.
 * Returns true when a cell or part of a span did not fit.
 */
export function appendSpannedCell(
  cells: string[],
  text: string,
  span: number,
  columnsMax: number,
): boolean {
  if (cells.length >= columnsMax) {
    return true
  }

  cells.push(text)

  const padding = Math.min(span - 1, columnsMax - cells.length)

  for (let index = 0; index < padding; index += 1) {
    cells.push('')
  }

  return span - 1 > padding
}

function escapeTableCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * Builds a Markdown table without ever holding more than `rowsMax` rows of
 * `columnsMax` cells, and stops once the text passes `maxBytes`, so a
 * hostile table costs no more than the output it can still produce. The
 * first row is the header.
 */
export function renderMarkdownTable(
  rows: string[][],
  options: TableOptions,
): RenderedTable {
  const reasons: TruncationReason[] = []
  const rowCount = Math.min(rows.length, options.rowsMax)
  let widest = 0

  for (let index = 0; index < rowCount; index += 1) {
    widest = Math.max(widest, (rows[index] as string[]).length)
  }

  if (rows.length > options.rowsMax) {
    reasons.push('rows_limit')
  }

  if (widest > options.columnsMax) {
    reasons.push('columns_limit')
  }

  const width = Math.min(widest, options.columnsMax)

  if (width === 0) {
    return { text: '', reasons }
  }

  const lines: string[] = []
  let bytes = 0
  let hasCutCell = false

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows[index] as string[]
    const cells: string[] = []

    for (let column = 0; column < width; column += 1) {
      const cell = row[column] ?? ''

      hasCutCell = hasCutCell || cell.length > options.cellCharsMax
      cells.push(escapeTableCell(cutToCharacters(cell, options.cellCharsMax)))
    }

    const line = `| ${cells.join(' | ')} |`

    lines.push(line)

    if (index === 0) {
      lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
    }

    bytes += utf8Length(line) + 1

    if (bytes > options.maxBytes) {
      break
    }
  }

  if (hasCutCell) {
    reasons.push('cell_chars_limit')
  }

  return { text: lines.join('\n'), reasons }
}
