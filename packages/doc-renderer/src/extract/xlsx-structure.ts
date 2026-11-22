import type { XmlEvent } from '../validate/xml.ts'
import type { ZipEntry } from '../validate/zip.ts'
import { parseRangeList, rangeAddress } from '../workbook-map/address.ts'
import type {
  ComparisonOperator,
  ConditionalKind,
  SheetNotRead,
  ValidationKind,
  WorkbookConditionalRule,
  WorkbookNote,
  WorkbookValidationRule,
} from '../workbook-map/types.ts'
import {
  findEntry,
  hasOptionalRoom,
  readOptional,
  readPartTail,
  readRelationships,
  scanPart,
} from './common.ts'
import type { OfficePackage } from './common.ts'

export const BUILT_IN_FORMAT_CODES: ReadonlyMap<number, string> = new Map([
  [1, '0'],
  [2, '0.00'],
  [3, '#,##0'],
  [4, '#,##0.00'],
  [9, '0%'],
  [10, '0.00%'],
  [11, '0.00E+00'],
  [12, '# ?/?'],
  [13, '# ??/??'],
  [14, 'mm-dd-yy'],
  [15, 'd-mmm-yy'],
  [16, 'd-mmm'],
  [17, 'mmm-yy'],
  [18, 'h:mm AM/PM'],
  [19, 'h:mm:ss AM/PM'],
  [20, 'h:mm'],
  [21, 'h:mm:ss'],
  [22, 'm/d/yy h:mm'],
  [37, '#,##0 ;(#,##0)'],
  [38, '#,##0 ;[Red](#,##0)'],
  [39, '#,##0.00;(#,##0.00)'],
  [40, '#,##0.00;[Red](#,##0.00)'],
  [45, 'mm:ss'],
  [46, '[h]:mm:ss'],
  [47, 'mmss.0'],
  [48, '##0.0E+0'],
  [49, '@'],
])

export interface SheetStructure {
  mergedRanges: string[]
  validations: WorkbookValidationRule[]
  conditionalRules: WorkbookConditionalRule[]
  notes: WorkbookNote[]
  notRead: SheetNotRead
  isTailCut: boolean
}

const RANGES_PER_RULE_MAX = 50
const MERGED_STORED_MAX = 2000
const VALIDATIONS_STORED_MAX = 500
const CONDITIONAL_STORED_MAX = 2000
const NOTES_STORED_MAX = 500
const NOTE_CHARACTERS_MAX = 2000
const RULE_TEXT_CHARACTERS_MAX = 2000
const LIST_VALUES_MAX = 100
const COMMENTS_PART_BYTES_MAX = 8 * 1024 * 1024
const COUNT_MAX = 9999
const COMMENTS_TYPE_SUFFIX = '/comments'
const DRAWING_TYPE_SUFFIX = '/drawing'
const CHART_TYPE_SUFFIX = '/chart'
const IMAGE_TYPE_SUFFIX = '/image'
const PIVOT_TYPE_SUFFIX = '/pivotTable'
const THREADED_PLACEHOLDER = '[Threaded comment]'
const THREADED_TEXT_MARKER = 'Comment:'

const OPERATORS: Record<string, ComparisonOperator> = {
  between: 'between',
  notBetween: 'not-between',
  equal: 'equal',
  notEqual: 'not-equal',
  greaterThan: 'greater-than',
  lessThan: 'less-than',
  greaterThanOrEqual: 'greater-than-or-equal',
  lessThanOrEqual: 'less-than-or-equal',
}

const VALIDATION_KINDS: Record<string, ValidationKind> = {
  whole: 'whole-number',
  decimal: 'decimal',
  date: 'date',
  time: 'time',
  textLength: 'text-length',
  custom: 'custom',
}

const CONDITIONAL_KINDS: Record<string, ConditionalKind> = {
  expression: 'formula',
  cellIs: 'cell-value',
  containsText: 'text-contains',
  notContainsText: 'text-not-contains',
  beginsWith: 'text-begins-with',
  endsWith: 'text-ends-with',
  containsBlanks: 'blanks',
  notContainsBlanks: 'no-blanks',
  containsErrors: 'errors',
  notContainsErrors: 'no-errors',
  duplicateValues: 'duplicates',
  uniqueValues: 'unique',
  timePeriod: 'date-period',
}

export function emptyNotRead(): SheetNotRead {
  return {
    charts: 0,
    images: 0,
    pivotTables: 0,
    colorScales: 0,
    dataBars: 0,
    iconSets: 0,
    hyperlinks: 0,
    threadedComments: 0,
  }
}

function isTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function rangesOf(sqref: string): string[] {
  return parseRangeList(sqref, RANGES_PER_RULE_MAX).map(rangeAddress)
}

function appendCapped(current: string, text: string, max: number): string {
  return current.length >= max ? current : current + text
}

function splitListValues(formula: string): string[] {
  const inner = formula.slice(1, formula.endsWith('"') ? -1 : undefined)

  return inner
    .split(',')
    .slice(0, LIST_VALUES_MAX)
    .map(value => value.trim())
}

interface PendingValidation {
  attributes: Record<string, string>
  formulas: [string, string]
  sqref: string
}

interface PendingConditional {
  attributes: Record<string, string>
  formulas: string[]
}

/**
 * Collects the elements a worksheet stores after its cells: merged cells,
 * data validation and conditional formatting (the main elements and the
 * `x14` extension forms Excel uses for references to other sheets) and
 * hyperlinks (counted only). Namespace prefixes are already dropped by the
 * tokenizer, so `x14:dataValidation` arrives as `dataValidation` and
 * `xm:f`/`xm:sqref` as `f`/`sqref`.
 */
export class SheetTailReader {
  readonly structure: SheetStructure

  private validation: PendingValidation | null = null
  private formulaSlot = 0
  private conditionalSqref: string | null = null
  private pendingRules: PendingConditional[] = []
  private rule: PendingConditional | null = null
  private isInRuleFormula = false
  private isInSqref = false
  private sqrefText = ''
  private extDepth = 0

  constructor(structure: SheetStructure) {
    this.structure = structure
  }

  consume(event: XmlEvent): void {
    if (event.type === 'start') {
      this.start(event.name, event.attributes)
    } else if (event.type === 'text') {
      this.text(event.text)
    } else {
      this.end(event.name)
    }
  }

  private start(name: string, attributes: Record<string, string>): void {
    switch (name) {
      case 'ext':
        this.extDepth += 1
        break
      case 'mergeCell':
        if (this.structure.mergedRanges.length < MERGED_STORED_MAX) {
          this.structure.mergedRanges.push(...rangesOf(attributes.ref ?? ''))
        }

        break
      case 'hyperlink':
        this.structure.notRead.hyperlinks = Math.min(
          this.structure.notRead.hyperlinks + 1,
          COUNT_MAX,
        )
        break
      case 'dataValidation':
        this.validation = {
          attributes,
          formulas: ['', ''],
          sqref: attributes.sqref ?? '',
        }
        break
      case 'formula1':
      case 'formula2':
        this.formulaSlot = name === 'formula1' ? 1 : 2
        break
      case 'conditionalFormatting':
        this.conditionalSqref = attributes.sqref ?? ''
        this.pendingRules = []
        break
      case 'cfRule':
        this.rule = { attributes, formulas: [] }
        break
      case 'formula':
      case 'f':
        if (this.rule && this.validation === null) {
          this.isInRuleFormula = true
          this.rule.formulas.push('')
        }

        break
      case 'sqref':
        this.isInSqref = true
        this.sqrefText = ''
        break
    }
  }

  private text(text: string): void {
    if (this.isInSqref) {
      this.sqrefText = appendCapped(
        this.sqrefText,
        text,
        RULE_TEXT_CHARACTERS_MAX,
      )

      return
    }

    if (this.validation && this.formulaSlot > 0) {
      const index = this.formulaSlot - 1

      this.validation.formulas[index] = appendCapped(
        this.validation.formulas[index] as string,
        text,
        RULE_TEXT_CHARACTERS_MAX,
      )

      return
    }

    if (this.rule && this.isInRuleFormula) {
      const last = this.rule.formulas.length - 1

      this.rule.formulas[last] = appendCapped(
        this.rule.formulas[last] as string,
        text,
        RULE_TEXT_CHARACTERS_MAX,
      )
    }
  }

  private end(name: string): void {
    switch (name) {
      case 'ext':
        this.extDepth = Math.max(this.extDepth - 1, 0)
        break
      case 'formula1':
      case 'formula2':
        this.formulaSlot = 0
        break
      case 'formula':
      case 'f':
        this.isInRuleFormula = false
        break
      case 'sqref':
        this.isInSqref = false
        this.assignSqref()
        break
      case 'dataValidation':
        this.finishValidation()
        break
      case 'cfRule':
        if (this.rule) {
          this.pendingRules.push(this.rule)
        }

        this.rule = null
        break
      case 'conditionalFormatting':
        this.finishConditional()
        break
    }
  }

  private assignSqref(): void {
    if (this.validation) {
      this.validation.sqref = this.sqrefText
    } else if (this.conditionalSqref !== null) {
      this.conditionalSqref = this.sqrefText
    }
  }

  private finishValidation(): void {
    const pending = this.validation

    this.validation = null
    this.formulaSlot = 0

    if (
      !pending
      || this.structure.validations.length >= VALIDATIONS_STORED_MAX
    ) {
      return
    }

    const ranges = rangesOf(pending.sqref)

    if (ranges.length === 0) {
      return
    }

    this.structure.validations.push(buildValidation(pending, ranges))
  }

  private finishConditional(): void {
    const ranges = rangesOf(this.conditionalSqref ?? '')
    const isExtension = this.extDepth > 0

    for (const pending of this.pendingRules) {
      const type = pending.attributes.type ?? ''

      if (type === 'colorScale' || type === 'dataBar' || type === 'iconSet') {
        if (!isExtension) {
          this.countVisualRule(type)
        }

        continue
      }

      const isFull = this.structure.conditionalRules.length
        >= CONDITIONAL_STORED_MAX

      if (ranges.length > 0 && !isFull) {
        this.structure.conditionalRules.push(
          buildConditional(pending, ranges),
        )
      }
    }

    this.conditionalSqref = null
    this.pendingRules = []
  }

  private countVisualRule(type: string): void {
    const { notRead } = this.structure

    if (type === 'colorScale') {
      notRead.colorScales = Math.min(notRead.colorScales + 1, COUNT_MAX)
    } else if (type === 'dataBar') {
      notRead.dataBars = Math.min(notRead.dataBars + 1, COUNT_MAX)
    } else {
      notRead.iconSets = Math.min(notRead.iconSets + 1, COUNT_MAX)
    }
  }
}

function optionalText(value: string | undefined): string | undefined {
  return value && value.length > 0
    ? value.slice(0, RULE_TEXT_CHARACTERS_MAX)
    : undefined
}

function buildValidation(
  pending: PendingValidation,
  ranges: string[],
): WorkbookValidationRule {
  const { attributes } = pending
  const [first, second] = pending.formulas
  const type = attributes.type ?? 'none'
  const errorStyle = attributes.errorStyle ?? 'stop'
  const rule: WorkbookValidationRule = {
    ranges,
    kind: 'any',
    strict: isTrue(attributes.showErrorMessage) && errorStyle === 'stop',
  }

  if (type === 'list') {
    const isValues = first.trimStart().startsWith('"')

    rule.kind = isValues ? 'list-of-values' : 'list-from-range'

    if (isValues) {
      rule.values = splitListValues(first.trim())
    } else {
      rule.source = first
    }
  } else if (VALIDATION_KINDS[type]) {
    rule.kind = VALIDATION_KINDS[type] as ValidationKind
    rule.formulas = [first, second].filter(formula => formula.length > 0)

    if (type !== 'custom') {
      rule.operator = OPERATORS[attributes.operator ?? 'between'] ?? 'between'
    }
  }

  const inputTitle = optionalText(attributes.promptTitle)
  const inputMessage = optionalText(attributes.prompt)
  const errorMessage = optionalText(attributes.error)

  if (inputTitle) {
    rule.inputTitle = inputTitle
  }

  if (inputMessage) {
    rule.inputMessage = inputMessage
  }

  if (errorMessage) {
    rule.errorMessage = errorMessage
  }

  return rule
}

function buildConditional(
  pending: PendingConditional,
  ranges: string[],
): WorkbookConditionalRule {
  const { attributes } = pending
  const type = attributes.type ?? ''
  let kind: ConditionalKind = CONDITIONAL_KINDS[type] ?? 'other'

  if (type === 'top10') {
    kind = isTrue(attributes.bottom) ? 'bottom' : 'top'
  } else if (type === 'aboveAverage') {
    kind = attributes.aboveAverage === '0' ? 'below-average' : 'above-average'
  }

  const rule: WorkbookConditionalRule = { ranges, kind }

  if (kind === 'formula') {
    rule.formulas = pending.formulas.slice(0, 1)
  } else if (kind === 'cell-value') {
    rule.operator = OPERATORS[attributes.operator ?? ''] ?? 'equal'
    rule.formulas = pending.formulas.slice(0, 2)
  } else if (kind.startsWith('text-')) {
    rule.text = (attributes.text ?? '').slice(0, RULE_TEXT_CHARACTERS_MAX)
  } else if (kind === 'top' || kind === 'bottom') {
    const rank = Number(attributes.rank ?? 10)

    rule.rank = Number.isFinite(rank) ? rank : 10
    rule.percent = isTrue(attributes.percent)
  } else if (kind === 'date-period') {
    rule.period = (attributes.timePeriod ?? '').slice(0, 40)
  }

  if (isTrue(attributes.stopIfTrue)) {
    rule.stopIfTrue = true
  }

  return rule
}

/**
 * A threaded comment reaches the legacy notes part as a placeholder with an
 * explanation for old Excel versions before the real text; keep the text.
 */
function noteText(text: string): string {
  const trimmed = text.trim()

  if (!trimmed.startsWith(THREADED_PLACEHOLDER)) {
    return trimmed
  }

  const marker = trimmed.indexOf(THREADED_TEXT_MARKER)

  if (marker === -1) {
    return trimmed
  }

  return `(threaded) ${trimmed.slice(marker + THREADED_TEXT_MARKER.length).trim()}`
}

function readCommentsPart(
  officePackage: OfficePackage,
  entry: ZipEntry,
  notes: WorkbookNote[],
): void {
  if (
    entry.uncompressedSize > COMMENTS_PART_BYTES_MAX
    || !hasOptionalRoom(officePackage, entry.uncompressedSize)
  ) {
    return
  }

  scanPart(officePackage, entry, (events) => {
    notes.length = 0

    let address: string | null = null
    let text = ''
    let isInText = false
    let phoneticDepth = 0

    for (const event of events) {
      if (event.type === 'start') {
        if (event.name === 'comment') {
          const [range] = parseRangeList(event.attributes.ref ?? '', 1)

          address = range ? rangeAddress(range) : null
          text = ''
        } else if (event.name === 'rPh') {
          phoneticDepth += 1
        } else if (event.name === 't') {
          isInText = phoneticDepth === 0
        }
      } else if (event.type === 'text') {
        if (isInText && address !== null) {
          text = appendCapped(text, event.text, NOTE_CHARACTERS_MAX)
        }
      } else if (event.name === 't') {
        isInText = false
      } else if (event.name === 'rPh') {
        phoneticDepth -= 1
      } else if (event.name === 'comment') {
        if (address !== null && notes.length < NOTES_STORED_MAX) {
          notes.push({ address, text: noteText(text) })
        }

        address = null
      }
    }

    return false
  })
}

function countDrawing(
  officePackage: OfficePackage,
  drawingPart: string,
  notRead: SheetNotRead,
): void {
  const relationships = readRelationships(officePackage, drawingPart)
  const images = new Set<string>()

  for (const relationship of relationships) {
    if (relationship.type.endsWith(CHART_TYPE_SUFFIX)) {
      notRead.charts = Math.min(notRead.charts + 1, COUNT_MAX)
    } else if (relationship.type.endsWith(IMAGE_TYPE_SUFFIX)) {
      images.add(relationship.target)
    }
  }

  notRead.images = Math.min(notRead.images + images.size, COUNT_MAX)
}

/**
 * The structure stored outside the cells of one worksheet: what follows
 * `</sheetData>` in the sheet part, legacy notes from its comments part, and
 * counts of the charts, images and pivot tables it links to. Every read
 * runs on the optional budget; a part that cannot be read is skipped and
 * `isTailCut` says the rules may be incomplete.
 */
export function readSheetStructure(
  officePackage: OfficePackage,
  entry: ZipEntry,
  partName: string,
): SheetStructure {
  const structure: SheetStructure = {
    mergedRanges: [],
    validations: [],
    conditionalRules: [],
    notes: [],
    notRead: emptyNotRead(),
    isTailCut: false,
  }
  const tailRead = readOptional(officePackage, () => {
    const reader = new SheetTailReader(structure)

    if (!hasOptionalRoom(officePackage, entry.uncompressedSize)) {
      return false
    }

    const tail = readPartTail(officePackage, entry, 'sheetData')

    if (tail === null) {
      if (entry.uncompressedSize > officePackage.limits.tailBytesMax) {
        return false
      }

      scanPart(officePackage, entry, (events) => {
        for (const event of events) {
          reader.consume(event)
        }

        return false
      })

      return true
    }

    for (const event of tail.events) {
      reader.consume(event)
    }

    return !tail.isCut
  })

  structure.isTailCut = tailRead !== true

  readOptional(officePackage, () => {
    for (const relationship of readRelationships(officePackage, partName)) {
      if (relationship.isExternal) {
        continue
      }

      const { type, target } = relationship

      if (type.endsWith(COMMENTS_TYPE_SUFFIX)) {
        const comments = findEntry(officePackage, target)

        if (comments) {
          readOptional(officePackage, () => {
            readCommentsPart(officePackage, comments, structure.notes)
          })
        }
      } else if (type.endsWith(DRAWING_TYPE_SUFFIX)) {
        readOptional(officePackage, () => {
          countDrawing(officePackage, target, structure.notRead)
        })
      } else if (type.endsWith(PIVOT_TYPE_SUFFIX)) {
        structure.notRead.pivotTables = Math.min(
          structure.notRead.pivotTables + 1,
          COUNT_MAX,
        )
      }
    }
  })

  return structure
}
