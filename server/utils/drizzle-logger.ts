import type { Logger } from 'drizzle-orm'
import { log } from 'evlog'

export class DrizzleQueryLogger implements Logger {
  logQuery(query: string, params: unknown[]): void {
    const formattedParams = params.length
      ? ` -- params: ${JSON.stringify(params)}`
      : ''

    log.debug('drizzle', `${query}${formattedParams}`)
  }
}
