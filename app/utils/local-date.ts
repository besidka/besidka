export type LocalDateValue = string | Date | number

function toValidDate(value: LocalDateValue): Date | null {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

export function toIsoDateTime(value: LocalDateValue): string | undefined {
  return toValidDate(value)?.toISOString()
}

export function formatLocalDate(
  value: LocalDateValue,
  withTime: boolean = false,
): string {
  const date = toValidDate(value)

  if (!date) {
    return ''
  }

  return withTime ? date.toLocaleString() : date.toLocaleDateString()
}
