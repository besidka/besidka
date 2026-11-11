const FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r\n＝＋－＠]/

export interface EscapeCsvCellOptions {
  style?: 'excel-resistant' | 'apostrophe'
}

/**
 * Neutralises spreadsheet formula injection in one CSV field. Cells starting
 * with =, +, -, @, tab, CR, LF or their full-width variants (U+FF1D, U+FF0B,
 * U+FF0D, U+FF20) are changed. The default is the OWASP Excel-resistant form:
 * a tab prefix inside a quoted field. The apostrophe form is not reliable in
 * Excel after saving and re-opening the CSV. Either way the prefix stays in
 * the data.
 */
export function escapeCsvCell(
  value: string | number | boolean | null | undefined,
  options: EscapeCsvCellOptions = {},
): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  const text = value === null || value === undefined ? '' : value
  const needsGuard = FORMULA_TRIGGER_PATTERN.test(text)
  const needsQuotes = needsGuard || /[",;\r\n]/.test(text)

  if (!needsQuotes) {
    return text
  }

  let guarded = text

  if (needsGuard) {
    guarded = options.style === 'apostrophe' ? `'${text}` : `\t${text}`
  }

  return `"${guarded.replace(/"/g, '""')}"`
}

export function toCsvRow(
  cells: readonly (string | number | boolean | null | undefined)[],
  options: EscapeCsvCellOptions = {},
): string {
  return cells.map(cell => escapeCsvCell(cell, options)).join(',')
}
