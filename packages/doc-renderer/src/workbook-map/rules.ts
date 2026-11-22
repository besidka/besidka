import { formulaTemplate } from './formula.ts'
import { joinRangeTexts, listWithRest } from './ranges.ts'
import { ELLIPSIS, cleanLine, quote } from './text.ts'
import type {
  ComparisonOperator,
  ConditionalKind,
  WorkbookConditionalRule,
  WorkbookMapOptions,
  WorkbookValidationRule,
} from './types.ts'

const RANGE_CHARACTERS_MAX = 64
const VALUE_CHARACTERS_MAX = 80
const LIST_VALUES_MAX = 20
const LITERAL_MARKER = ''

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  'between': 'between',
  'not-between': 'not between',
  'equal': 'equal to',
  'not-equal': 'not equal to',
  'greater-than': 'greater than',
  'less-than': 'less than',
  'greater-than-or-equal': 'greater than or equal to',
  'less-than-or-equal': 'less than or equal to',
}

const VALIDATION_LABELS: Record<WorkbookValidationRule['kind'], string> = {
  'list-from-range': 'dropdown of the values in',
  'list-of-values': 'dropdown with values',
  'whole-number': 'whole number',
  'decimal': 'decimal number',
  'date': 'date',
  'time': 'time',
  'text-length': 'text length',
  'custom': 'custom formula',
  'any': 'any value',
}

const CONDITIONAL_LABELS: Record<ConditionalKind, string> = {
  'formula': 'formula',
  'cell-value': 'cell value',
  'text-contains': 'text contains',
  'text-not-contains': 'text does not contain',
  'text-begins-with': 'text begins with',
  'text-ends-with': 'text ends with',
  'blanks': 'cell is blank',
  'no-blanks': 'cell is not blank',
  'errors': 'cell has an error',
  'no-errors': 'cell has no error',
  'duplicates': 'duplicate values',
  'unique': 'unique values',
  'top': 'top',
  'bottom': 'bottom',
  'above-average': 'above average',
  'below-average': 'below average',
  'date-period': 'date is',
  'other': 'other rule',
}

export function cleanRanges(
  ranges: readonly string[],
  options: WorkbookMapOptions,
): string {
  const cleaned = joinRangeTexts(ranges).map((range) => {
    return cleanLine(range, RANGE_CHARACTERS_MAX)
  })

  return listWithRest(cleaned, options.rangesPerItemMax)
}

function operand(formula: string, options: WorkbookMapOptions): string {
  return cleanLine(formula, options.formulaPrintCharactersMax)
}

function comparison(
  operator: ComparisonOperator | undefined,
  formulas: readonly string[] | undefined,
  options: WorkbookMapOptions,
): string {
  const label = OPERATOR_LABELS[operator ?? 'between']
  const [first, second] = formulas ?? []

  if (first === undefined) {
    return label
  }

  const isRange = operator === undefined
    || operator === 'between'
    || operator === 'not-between'

  if (isRange && second !== undefined) {
    return `${label} ${operand(first, options)} and ${operand(second, options)}`
  }

  return `${label} ${operand(first, options)}`
}

function describeValidation(
  rule: WorkbookValidationRule,
  options: WorkbookMapOptions,
): string {
  const label = VALIDATION_LABELS[rule.kind]
  let condition: string

  if (rule.kind === 'list-from-range') {
    condition = `${label} ${operand(rule.source ?? '', options)}`
  } else if (rule.kind === 'list-of-values') {
    const values = (rule.values ?? []).map((value) => {
      return cleanLine(value, VALUE_CHARACTERS_MAX)
    })

    condition = `${label}: ${listWithRest(values, LIST_VALUES_MAX)}`
  } else if (rule.kind === 'custom') {
    condition = `${label} =${operand(rule.formulas?.[0] ?? '', options)}`
  } else if (rule.kind === 'any') {
    condition = label
  } else {
    condition = `${label} ${comparison(rule.operator, rule.formulas, options)}`
  }

  const flags: string[] = []

  if (rule.kind !== 'any') {
    flags.push(rule.strict ? 'strict' : 'not enforced, warning only')
  }

  if (rule.allowBlank === false) {
    flags.push('blank not allowed')
  }

  const parts = [
    flags.length > 0 ? `${condition} (${flags.join(', ')})` : condition,
  ]
  const input = [rule.inputTitle, rule.inputMessage]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(': ')

  if (input.length > 0) {
    parts.push(`input message ${quote(input, options.messageCharactersMax)}`)
  }

  if (rule.errorMessage && rule.errorMessage.trim().length > 0) {
    parts.push(
      `error message ${quote(rule.errorMessage, options.messageCharactersMax)}`,
    )
  }

  return parts.join('; ')
}

function validationKey(rule: WorkbookValidationRule): string {
  return JSON.stringify([
    rule.kind,
    rule.operator ?? null,
    rule.source ?? null,
    rule.values ?? null,
    rule.formulas ?? null,
    rule.strict,
    rule.allowBlank ?? null,
    rule.inputTitle ?? null,
    rule.inputMessage ?? null,
    rule.errorMessage ?? null,
  ])
}

function mergeByKey<Rule extends { ranges: string[] }>(
  rules: readonly Rule[],
  keyOf: (rule: Rule) => string,
): Rule[] {
  const merged = new Map<string, Rule>()

  for (const rule of rules) {
    const key = keyOf(rule)
    const existing = merged.get(key)

    if (!existing) {
      merged.set(key, { ...rule, ranges: [...rule.ranges] })
      continue
    }

    for (const range of rule.ranges) {
      if (!existing.ranges.includes(range)) {
        existing.ranges.push(range)
      }
    }
  }

  return [...merged.values()]
}

/**
 * One line per distinct rule; rules that differ only in their ranges share a
 * line. Returns the lines and how many distinct rules were not printed.
 */
export function renderValidations(
  rules: readonly WorkbookValidationRule[],
  options: WorkbookMapOptions,
): { lines: string[], omitted: number } {
  const merged = mergeByKey(rules, validationKey)
  const shown = merged.slice(0, options.validationRulesMax)

  return {
    lines: shown.map((rule) => {
      return `- ${cleanRanges(rule.ranges, options)}: `
        + describeValidation(rule, options)
    }),
    omitted: merged.length - shown.length,
  }
}

interface ConditionalShape {
  template: string
  literals: string[]
}

function conditionalShape(rule: WorkbookConditionalRule): ConditionalShape {
  const literals: string[] = []
  const pieces: string[] = [rule.kind, rule.operator ?? '']

  for (const formula of rule.formulas ?? []) {
    pieces.push(templateOf(formula, literals))
  }

  if (rule.text !== undefined) {
    pieces.push(LITERAL_MARKER)
    literals.push(`"${rule.text}"`)
  }

  pieces.push(String(rule.rank ?? ''), String(rule.percent ?? ''))
  pieces.push(rule.period ?? '', String(rule.stopIfTrue ?? ''))

  return { template: pieces.join('\u0001'), literals }
}

function templateOf(formula: string, literals: string[]): string {
  return formulaTemplate(formula, LITERAL_MARKER, literals)
}

function describeConditional(
  rule: WorkbookConditionalRule,
  options: WorkbookMapOptions,
): string {
  const label = CONDITIONAL_LABELS[rule.kind]
  let condition: string

  switch (rule.kind) {
    case 'formula':
      condition = `${label} =${operand(rule.formulas?.[0] ?? '', options)}`
      break
    case 'cell-value':
      condition = `${label} ${comparison(rule.operator, rule.formulas, options)}`
      break
    case 'text-contains':
    case 'text-not-contains':
    case 'text-begins-with':
    case 'text-ends-with':
      condition = `${label} ${quote(rule.text ?? '', VALUE_CHARACTERS_MAX)}`
      break
    case 'top':
    case 'bottom':
      condition = `${label} ${rule.rank ?? 10}${rule.percent ? '%' : ''}`
      break
    case 'date-period':
      condition = `${label} ${cleanLine(rule.period ?? '', 40)}`
      break
    default:
      condition = label
  }

  return rule.stopIfTrue ? `${condition} (stop if true)` : condition
}

function restoreLiterals(
  text: string,
  fixed: ReadonlyMap<number, string>,
): { text: string, varying: number } {
  const pieces = text.split(LITERAL_MARKER)
  let result = pieces[0] as string
  let varying = 0

  for (let index = 1; index < pieces.length; index += 1) {
    const literal = fixed.get(index - 1)

    if (literal === undefined) {
      result += ELLIPSIS
      varying += 1
    } else {
      result += literal
    }

    result += pieces[index] as string
  }

  return { text: result, varying }
}

function conditionalKey(rule: WorkbookConditionalRule): string {
  return JSON.stringify([
    rule.kind,
    rule.operator ?? null,
    rule.formulas ?? null,
    rule.text ?? null,
    rule.rank ?? null,
    rule.percent ?? null,
    rule.period ?? null,
    rule.stopIfTrue ?? null,
  ])
}

function describeGroup(
  group: WorkbookConditionalRule[],
  options: WorkbookMapOptions,
): string {
  const first = group[0] as WorkbookConditionalRule
  const shapes = group.map(conditionalShape)
  const firstShape = shapes[0] as ConditionalShape
  const fixed = new Map<number, string>()

  firstShape.literals.forEach((literal, index) => {
    const isFixed = shapes.every(shape => shape.literals[index] === literal)

    if (isFixed) {
      fixed.set(index, literal)
    }
  })

  const markedRule: WorkbookConditionalRule = {
    ...first,
    formulas: first.formulas?.map((formula) => {
      return templateOf(formula, [])
    }),
    text: first.text === undefined ? undefined : LITERAL_MARKER,
  }
  const restored = restoreLiterals(
    describeConditional(markedRule, options).split(`"${LITERAL_MARKER}"`)
      .join(LITERAL_MARKER),
    remapFixed(markedRule, fixed),
  )
  const varyingIndexes = firstShape.literals
    .map((_literal, index) => index)
    .filter(index => !fixed.has(index))
  const variants = shapes.map((shape) => {
    const values = varyingIndexes.map((index) => {
      return cleanLine(shape.literals[index] ?? '', VALUE_CHARACTERS_MAX)
    })

    return values.length === 1 ? values[0] as string : `(${values.join(', ')})`
  })
  const placeholder = restored.varying === 1
    ? ELLIPSIS
    : `(${Array.from({ length: restored.varying }, () => ELLIPSIS).join(', ')})`

  return `${group.length} rules, ${restored.text} with ${placeholder} = `
    + listWithRest(variants, options.literalVariantsMax)
}

function remapFixed(
  rule: WorkbookConditionalRule,
  fixed: ReadonlyMap<number, string>,
): Map<number, string> {
  const remapped = new Map<number, string>()
  const count = (rule.formulas ?? []).reduce((total, formula) => {
    return total + formula.split(LITERAL_MARKER).length - 1
  }, 0) + (rule.text === undefined ? 0 : 1)

  for (let index = 0; index < count; index += 1) {
    const literal = fixed.get(index)

    if (literal !== undefined) {
      remapped.set(index, cleanLine(literal, VALUE_CHARACTERS_MAX))
    }
  }

  return remapped
}

/**
 * Conditional rules in their order. Identical rules on several ranges share a
 * line; rules on the same ranges that differ only in string or number
 * literals become one line that lists the literals, so fifty rules that
 * color fifty categories cost one line. Colors are never read.
 */
export function renderConditionalRules(
  rules: readonly WorkbookConditionalRule[],
  options: WorkbookMapOptions,
): { lines: string[], omitted: number, groups: number } {
  const merged = mergeByKey(rules, conditionalKey)
  const groups = new Map<string, WorkbookConditionalRule[]>()

  for (const rule of merged) {
    const key = `${conditionalShape(rule).template}\u0002`
      + rule.ranges.join(' ')
    const group = groups.get(key)

    if (group) {
      group.push(rule)
    } else {
      groups.set(key, [rule])
    }
  }

  const all = [...groups.values()]
  const shown = all.slice(0, options.conditionalGroupsMax)

  return {
    lines: shown.map((group) => {
      const first = group[0] as WorkbookConditionalRule
      const description = group.length === 1
        ? describeConditional(first, options)
        : describeGroup(group, options)

      return `- ${cleanRanges(first.ranges, options)}: ${description}`
    }),
    omitted: all.length - shown.length,
    groups: all.length,
  }
}
