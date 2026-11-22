import type {
  ComparisonOperator,
  ConditionalKind,
  ValidationKind,
  WorkbookConditionalRule,
  WorkbookValidationRule,
} from '@besidka/doc-renderer/workbook-map'

type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

const COMPARISON_OPERATORS: Readonly<Record<string, ComparisonOperator>> = {
  EQ: 'equal',
  NOT_EQ: 'not-equal',
  GREATER: 'greater-than',
  GREATER_THAN_EQ: 'greater-than-or-equal',
  LESS: 'less-than',
  LESS_THAN_EQ: 'less-than-or-equal',
  BEFORE: 'less-than',
  AFTER: 'greater-than',
  ON_OR_BEFORE: 'less-than-or-equal',
  ON_OR_AFTER: 'greater-than-or-equal',
  BETWEEN: 'between',
  NOT_BETWEEN: 'not-between',
}

const NUMBER_PREFIX = 'NUMBER_'
const DATE_PREFIX = 'DATE_'
const MAX_VALUES = 50

interface ConditionValue {
  text: string
  isRelativeDate: boolean
}

export interface ParsedCondition {
  type: string
  values: ConditionValue[]
}

export function stripEquals(formula: string): string {
  return formula.startsWith('=') ? formula.slice(1) : formula
}

export function parseCondition(value: unknown): ParsedCondition | null {
  const condition = asRecord(value)
  const type = asString(condition?.type)

  if (!condition || !type) {
    return null
  }

  const values: ConditionValue[] = []

  for (const item of asArray(condition.values).slice(0, MAX_VALUES)) {
    const record = asRecord(item)
    const entered = asString(record?.userEnteredValue)
    const relative = asString(record?.relativeDate)

    if (entered !== undefined) {
      values.push({ text: entered, isRelativeDate: false })
    } else if (relative !== undefined) {
      values.push({ text: relative, isRelativeDate: true })
    }
  }

  return { type, values }
}

function operatorOf(
  type: string,
  prefix: string,
): ComparisonOperator | undefined {
  return COMPARISON_OPERATORS[type.slice(prefix.length)]
}

function operandTexts(condition: ParsedCondition): string[] {
  return condition.values.map((value) => {
    return value.isRelativeDate ? value.text : stripEquals(value.text)
  })
}

function quoteLiteral(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * A condition the model has no kind for, kept as a call-like text so it is
 * never dropped: `TEXT_IS_EMAIL()` or `TEXT_EQ("Lead")`.
 */
function callText(condition: ParsedCondition): string {
  const operands = condition.values.map((value) => {
    return value.isRelativeDate ? value.text : quoteLiteral(value.text)
  })

  return `${condition.type}(${operands.join(', ')})`
}

type ValidationFields = Omit<WorkbookValidationRule, 'ranges' | 'strict'>

/**
 * The model's validation kind of a Sheets condition. `NUMBER_*` becomes a
 * decimal rule and `DATE_*` a date rule with the matching operator;
 * `ONE_OF_RANGE` is a dropdown of a range, `ONE_OF_LIST` a dropdown of
 * values and `BOOLEAN` a checkbox (its two values); `CUSTOM_FORMULA` is a
 * custom rule. Every other type (text checks, email, link, valid date,
 * blank) is a custom rule written as `TYPE(values)`, so nothing is lost.
 */
export function validationFields(
  condition: ParsedCondition,
): ValidationFields {
  const { type } = condition
  const operands = operandTexts(condition)

  if (type === 'ONE_OF_RANGE') {
    return { kind: 'list-from-range', source: operands[0] ?? '' }
  }

  if (type === 'ONE_OF_LIST') {
    return {
      kind: 'list-of-values',
      values: condition.values.map(value => value.text),
    }
  }

  if (type === 'BOOLEAN') {
    return {
      kind: 'list-of-values',
      values: condition.values.length > 0
        ? condition.values.map(value => value.text)
        : ['TRUE', 'FALSE'],
    }
  }

  if (type === 'CUSTOM_FORMULA') {
    return { kind: 'custom', formulas: [operands[0] ?? ''] }
  }

  const kind: ValidationKind | null = rangedKind(type)
  const prefix = type.startsWith(NUMBER_PREFIX) ? NUMBER_PREFIX : DATE_PREFIX
  const operator = kind ? operatorOf(type, prefix) : undefined

  if (kind && operator) {
    return { kind, operator, formulas: operands }
  }

  return { kind: 'custom', formulas: [callText(condition)] }
}

function rangedKind(type: string): ValidationKind | null {
  if (type.startsWith(NUMBER_PREFIX)) {
    return 'decimal'
  }

  return type.startsWith(DATE_PREFIX) ? 'date' : null
}

const TEXT_CONDITIONS: Readonly<Record<string, ConditionalKind>> = {
  TEXT_CONTAINS: 'text-contains',
  TEXT_NOT_CONTAINS: 'text-not-contains',
  TEXT_STARTS_WITH: 'text-begins-with',
  TEXT_ENDS_WITH: 'text-ends-with',
}

type ConditionalFields = Omit<WorkbookConditionalRule, 'ranges'>

/**
 * The model's conditional kind of a boolean-rule condition: a custom
 * formula, a comparison, a text test, blank or not blank. Anything else
 * (a dropdown match, a valid-date test, an email or link test) is
 * `other`. Colors are never read.
 */
export function conditionalFields(
  condition: ParsedCondition,
): ConditionalFields {
  const { type } = condition
  const operands = operandTexts(condition)

  if (type === 'CUSTOM_FORMULA') {
    return { kind: 'formula', formulas: [operands[0] ?? ''] }
  }

  if (type === 'BLANK') {
    return { kind: 'blanks' }
  }

  if (type === 'NOT_BLANK') {
    return { kind: 'no-blanks' }
  }

  const textKind = TEXT_CONDITIONS[type]

  if (textKind) {
    return { kind: textKind, text: condition.values[0]?.text ?? '' }
  }

  if (type === 'TEXT_EQ' || type === 'TEXT_NOT_EQ') {
    const text = quoteLiteral(condition.values[0]?.text ?? '')

    return {
      kind: 'cell-value',
      operator: type === 'TEXT_EQ' ? 'equal' : 'not-equal',
      formulas: [text],
    }
  }

  const kind = rangedKind(type)
  const prefix = type.startsWith(NUMBER_PREFIX) ? NUMBER_PREFIX : DATE_PREFIX
  const operator = kind ? operatorOf(type, prefix) : undefined

  if (kind && operator) {
    return { kind: 'cell-value', operator, formulas: operands }
  }

  return { kind: 'other' }
}
