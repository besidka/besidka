export function parseRatePerThousandUsd(
  value: string | number | undefined,
): number | undefined {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
