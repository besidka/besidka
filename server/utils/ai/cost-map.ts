import { providers } from '~~/providers'

interface ModelCost {
  input: number
  output: number
}

/**
 * Parse a price string from providers/ data into a number of dollars.
 *
 * Accepted forms:
 *   '$0.25'        -> 0.25
 *   '$1,250.00'    -> 1250
 *   'from $2.00'   -> 2 (we treat ranged pricing as the floor)
 *   ''             -> NaN
 *
 * Returns NaN when the string is not parseable so callers can skip it.
 */
function parsePrice(value: string): number {
  if (!value) {
    return Number.NaN
  }

  const match = value.match(/\$?\s*([0-9]+(?:[.,][0-9]+)*)/)

  if (!match || !match[1]) {
    return Number.NaN
  }

  return Number(match[1].replace(/,/g, ''))
}

let cached: Record<string, ModelCost> | undefined

/**
 * Build the cost map consumed by evlog's `createAILogger({ cost })`.
 * Keys are model IDs; values are dollars per 1,000,000 tokens.
 *
 * The map is computed once per worker instance.
 */
export function getModelCostMap(): Record<string, ModelCost> {
  if (cached) {
    return cached
  }

  const result: Record<string, ModelCost> = {}

  for (const provider of providers) {
    for (const model of provider.models) {
      if (!model.price || model.price.tokens !== 1_000_000) {
        continue
      }

      const input = parsePrice(model.price.input)
      const output = parsePrice(model.price.output)

      if (Number.isNaN(input) || Number.isNaN(output)) {
        continue
      }

      result[model.id] = { input, output }
    }
  }

  cached = result

  return result
}
