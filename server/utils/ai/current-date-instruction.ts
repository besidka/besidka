const ISO_DATE_LENGTH = 10

export function buildCurrentDateInstruction(now: Date): string {
  const isoDate = now.toISOString().slice(0, ISO_DATE_LENGTH)

  return [
    `Today's date is ${isoDate} (UTC).`,
    'Use it for "today" and "latest" questions and for freshness filters;',
    'do not search for the current date.',
  ].join(' ')
}
