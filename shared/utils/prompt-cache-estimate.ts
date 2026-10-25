const TOKENS_PER_MILLION = 1_000_000
const PRICE_AMOUNT_PATTERN = /\$?\s*([0-9]+(?:[.,][0-9]+)*)/
const THOUSAND = 1000
const MIN_PRECISE_AMOUNT = 0.01
const SIGNIFICANT_DIGITS = 2

export interface PromptCacheCostInput {
  tokens: number
  turns: number
  inputPrice: number
  cacheReadPrice?: number | null
  cacheWritePrice?: number | null
}

export interface PromptCacheCostEstimate {
  uncached: number
  cached: number
  perChange: number
}

const ZERO_ESTIMATE: PromptCacheCostEstimate = {
  uncached: 0,
  cached: 0,
  perChange: 0,
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
}

function resolveCachePrice(
  price: number | null | undefined,
  inputPrice: number,
): number {
  return isNonNegativeNumber(price) ? price : inputPrice
}

/**
 * Estimates the cost in USD of sending the same `tokens` of context with
 * every one of `turns` messages. Prices are USD per 1M tokens. `cached`
 * pays one cache write on the first message and cache reads afterwards, and
 * `perChange` is the one-off extra a changed context costs on the next
 * message (a fresh write instead of a read). A cache price that is missing
 * or invalid falls back to the input price, so a model without published
 * cache prices degrades to "no savings" instead of a guess. Invalid input
 * (fewer than one turn, negative or non-finite numbers) yields zeros, never
 * NaN.
 */
export function estimatePromptCacheCost(
  input: PromptCacheCostInput,
): PromptCacheCostEstimate {
  const { tokens, inputPrice } = input
  const turns = Math.floor(input.turns)

  if (
    !isNonNegativeNumber(tokens)
    || !isNonNegativeNumber(inputPrice)
    || !Number.isFinite(turns)
    || turns < 1
  ) {
    return { ...ZERO_ESTIMATE }
  }

  const readPrice = resolveCachePrice(input.cacheReadPrice, inputPrice)
  const writePrice = resolveCachePrice(input.cacheWritePrice, inputPrice)
  const uncached = turns * tokens * inputPrice / TOKENS_PER_MILLION
  const cached = (
    tokens * writePrice + (turns - 1) * tokens * readPrice
  ) / TOKENS_PER_MILLION
  const perChange = tokens * (writePrice - readPrice) / TOKENS_PER_MILLION

  if (
    !Number.isFinite(uncached)
    || !Number.isFinite(cached)
    || !Number.isFinite(perChange)
  ) {
    return { ...ZERO_ESTIMATE }
  }

  return { uncached, cached, perChange }
}

/**
 * Reads a dollar amount out of a catalog price: a number as is, or a display
 * string such as `"$3.00"`, `"$1,250.00"` or `"from $2.00"` (ranged pricing
 * counts as its floor). Returns `null` when nothing parseable is there.
 */
export function parseUsdPrice(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === 'number') {
    return isNonNegativeNumber(value) ? value : null
  }

  if (!value) {
    return null
  }

  const match = value.match(PRICE_AMOUNT_PATTERN)

  if (!match || !match[1]) {
    return null
  }

  const amount = Number(match[1].replace(/,/g, ''))

  return isNonNegativeNumber(amount) ? amount : null
}

/**
 * Normalizes a price quoted for `unitTokens` tokens to USD per 1M tokens.
 */
export function toPricePerMillion(
  amount: number,
  unitTokens: number = TOKENS_PER_MILLION,
): number | null {
  if (!isNonNegativeNumber(amount) || !(unitTokens > 0)) {
    return null
  }

  return amount * TOKENS_PER_MILLION / unitTokens
}

/**
 * Formats a USD amount for prose: two decimals from $1 up, two significant
 * digits below it (`$0.28`, `$0.013`), and `< $0.01` for a positive amount
 * under a cent. Zero and invalid amounts read `$0.00`.
 */
export function formatCostUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) {
    return '$0.00'
  }

  const sign = amount < 0 ? '-' : ''
  const magnitude = Math.abs(amount)

  if (magnitude < MIN_PRECISE_AMOUNT) {
    return amount > 0 ? '< $0.01' : '$0.00'
  }

  const roundedPrecise = Number(magnitude.toPrecision(SIGNIFICANT_DIGITS))

  if (roundedPrecise < 1) {
    return `${sign}$${magnitude.toPrecision(SIGNIFICANT_DIGITS)}`
  }

  const formatted = magnitude.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return `${sign}$${formatted}`
}

/**
 * Formats a token count the way the docs quote it: `573`, `18.3k`, `64k`.
 */
export function formatApproxTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0'
  }

  if (tokens < THOUSAND) {
    return String(Math.round(tokens))
  }

  const thousands = Math.round(tokens / THOUSAND * 10) / 10

  return `${thousands}k`
}
