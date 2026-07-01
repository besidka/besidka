import type { Logger } from 'drizzle-orm'

export class DrizzleQueryLogger implements Logger {
  logQuery(query: string, params: unknown[]): void {
    const formattedParams = params.length
      ? ` -- params: ${JSON.stringify(params)}`
      : ''

    // eslint-disable-next-line no-console
    console.log(`[drizzle] ${query}${formattedParams}`)
  }
}
