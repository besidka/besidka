import { describe, expect, it, vi } from 'vitest'
import { readSpreadsheetMap } from '~~/server/utils/google/sheets-read'
import type { SheetsReadInput } from '~~/server/utils/google/sheets-read'
import type { SheetsReservation } from '~~/server/utils/google/sheets-rate-limit'
import {
  SHEET_IDS,
  SPREADSHEET_ID,
  estimateGridAnswers,
  estimateMetadata,
  gridAnswer,
} from '../../../../fixtures/google/sheets-estimate'

const TOKEN = 'ya29.test-token'
const MEBIBYTE = 1024 * 1024

interface FakeSheetsOptions {
  metadata?: Record<string, unknown>
  answers?: Record<number, object>
  respond?: (call: FakeCall) => Response | Error | undefined
  delayMs?: (call: FakeCall) => number
}

interface FakeCall {
  index: number
  url: URL
  range: string | null
  headers: Record<string, string>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function errorBody(
  status: number,
  googleStatus: string,
  reason?: string,
): Record<string, unknown> {
  return {
    error: {
      code: status,
      message: 'Free text that must never be kept',
      status: googleStatus,
      ...(reason
        ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] }
        : {}),
    },
  }
}

function sheetIdOfRange(range: string): number | undefined {
  const titles: Record<string, number> = {
    'Lists': SHEET_IDS.lists,
    'Parameters': SHEET_IDS.parameters,
    'Lines': SHEET_IDS.lines,
    '\'Extra\'\'s tab\'': SHEET_IDS.extra,
    'Summary': SHEET_IDS.summary,
  }

  return titles[range.split('!')[0] as string]
}

function createFakeSheets(options: FakeSheetsOptions = {}) {
  const calls: FakeCall[] = []
  const answers = options.answers ?? estimateGridAnswers()
  let active = 0
  let maxActive = 0
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const call: FakeCall = {
      index: calls.length,
      url,
      range: url.searchParams.get('ranges'),
      headers: Object.fromEntries(
        Object.entries(init.headers as Record<string, string>)
          .map(([name, value]) => [name.toLowerCase(), value]),
      ),
    }

    calls.push(call)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => {
      setTimeout(resolve, options.delayMs?.(call) ?? 0)
    })
    active -= 1

    const custom = options.respond?.(call)

    if (custom instanceof Error) {
      throw custom
    }

    if (custom) {
      return custom
    }

    if (!call.range) {
      return jsonResponse(options.metadata ?? estimateMetadata())
    }

    const sheetId = sheetIdOfRange(call.range)

    return sheetId === undefined
      ? jsonResponse(errorBody(404, 'NOT_FOUND'), 404)
      : jsonResponse(answers[sheetId])
  })

  return {
    calls,
    fetchImpl,
    maxActive: () => maxActive,
  }
}

function grant(count: number | 'all' = 'all') {
  return vi.fn(async (asked: number): Promise<SheetsReservation> => ({
    granted: count === 'all' ? asked : Math.min(count, asked),
    limitedBy: null,
    kvUnavailable: false,
  }))
}

function inputOf(
  fake: ReturnType<typeof createFakeSheets>,
  overrides: Partial<SheetsReadInput> = {},
): SheetsReadInput {
  return {
    spreadsheetId: SPREADSHEET_ID,
    accessToken: TOKEN,
    reserve: grant(),
    fetchImpl: fake.fetchImpl,
    ...overrides,
  }
}

describe('readSpreadsheetMap', () => {
  it('reads the structure alone, then one request per tab, two at a time',
    async () => {
      const fake = createFakeSheets({
        delayMs: call => call.range ? 3 : 0,
      })
      const result = await readSpreadsheetMap(inputOf(fake, {
        resourceKey: '0-resourceKey',
      }))

      expect(result.ok).toBe(true)
      expect(fake.calls).toHaveLength(6)
      expect(fake.maxActive()).toBe(2)
      expect(result.diagnostics.requests).toBe(6)
      expect(fake.calls.every(call => call.url.hostname
        === 'sheets.googleapis.com')).toBe(true)
      expect(fake.calls.every((call) => {
        return call.url.pathname === `/v4/spreadsheets/${SPREADSHEET_ID}`
          && call.url.searchParams.get('prettyPrint') === 'false'
          && !!call.url.searchParams.get('fields')
      })).toBe(true)
      expect(fake.calls.every((call) => {
        return call.headers.authorization === `Bearer ${TOKEN}`
          && call.headers['x-goog-drive-resource-keys']
          === `${SPREADSHEET_ID}/0-resourceKey`
      })).toBe(true)
      expect(fake.calls[0]?.range).toBeNull()
      expect(fake.calls[0]?.url.searchParams.get('fields'))
        .not.toContain('rowData')
      expect(fake.calls.slice(1).map(call => call.range)).toEqual([
        'Lists!A1:Z1000',
        'Parameters!A1:Z1000',
        'Lines!A1:Z1000',
        '\'Extra\'\'s tab\'!A1:Z1000',
        'Summary!A1:Z1000',
      ])
      expect(fake.calls[1]?.url.searchParams.get('fields'))
        .not.toMatch(/background|foreground|effectiveFormat/)
    })

  it('sends no includeGridData and no token in the URL', async () => {
    const fake = createFakeSheets()

    await readSpreadsheetMap(inputOf(fake))

    for (const call of fake.calls) {
      expect(call.url.searchParams.has('includeGridData')).toBe(false)
      expect(call.url.toString()).not.toContain(TOKEN)
    }
  })

  it('renders the whole workbook with no cut', async () => {
    const fake = createFakeSheets()
    const result = await readSpreadsheetMap(inputOf(fake))

    if (!result.ok) {
      throw new Error('expected a map')
    }

    expect(result.summary.sheets).toBe(5)
    expect(result.summary.cut).toEqual([])
    expect(result.text).toContain('## Sheet: Lines')
    expect(result.text).toContain('- E7:E24: dropdown of the values in '
      + 'Lists!$B$6:$B$45 (strict)')
    expect(result.diagnostics.tabsNotRead).toBe(0)
    expect(result.tabsTotal).toBe(5)
  })

  it('asks the rate buckets twice, never once per request', async () => {
    const fake = createFakeSheets()
    const reserve = grant()

    await readSpreadsheetMap(inputOf(fake, { reserve }))

    expect(reserve.mock.calls.map(call => call[0])).toEqual([1, 5])
  })

  it('reads a tab between 6 and 8 MiB alone, with the larger cap, after '
    + 'the first pass', async () => {
    const big = gridAnswer(SHEET_IDS.lines, 'Lines', {
      A1: { text: 'x'.repeat(3.5 * MEBIBYTE) },
    })
    const fake = createFakeSheets({
      answers: { ...estimateGridAnswers(), [SHEET_IDS.lines]: big },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    if (!result.ok) {
      throw new Error('expected a map')
    }

    const lineCalls = fake.calls.filter(call => call.range?.startsWith('Lines'))

    expect(lineCalls.map(call => call.range)).toEqual([
      'Lines!A1:Z1000',
      'Lines!A1:Z1000',
    ])
    expect(fake.calls.at(-1)?.range).toBe('Lines!A1:Z1000')
    expect(result.diagnostics.tabsNotRead).toBe(0)
    expect(result.diagnostics.requests).toBe(7)
    expect(result.diagnostics.bytes).toBeGreaterThan(7 * MEBIBYTE)
  })

  it('asks a quarter of the rows when an answer is over both caps, and '
    + 'says so in the map', async () => {
    const fake = createFakeSheets({
      respond: (call) => {
        return call.range === 'Lines!A1:Z1000'
          ? new Response('x'.repeat(13 * MEBIBYTE))
          : undefined
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    if (!result.ok) {
      throw new Error('expected a map')
    }

    const lineCalls = fake.calls.filter(call => call.range?.startsWith('Lines'))

    expect(lineCalls.map(call => call.range)).toEqual([
      'Lines!A1:Z1000',
      'Lines!A1:Z1000',
      'Lines!A1:Z250',
    ])
    expect(result.text).toContain('Only the first 250 rows were read')
    expect(result.diagnostics.tabsNotRead).toBe(0)
    expect(result.diagnostics.requests).toBe(8)
  })

  it('keeps the structure of a tab that is still too large and names it',
    async () => {
      const fake = createFakeSheets({
        respond: (call) => {
          return call.range?.startsWith('Lines')
            ? new Response('x'.repeat(13 * MEBIBYTE))
            : undefined
        },
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      expect(result.text).toContain('The cell values, formulas, dropdowns '
        + 'and notes of this sheet were not read')
      expect(result.text).toContain('- A7:H24: formula =$E7="Lead"')
      expect(result.diagnostics.tabsNotRead).toBe(1)
      expect(result.tabsImported).toBe(4)
      expect(result.tabsTotal).toBe(5)
      expect(result.diagnostics.failures[0]).toContain('response_too_large')
      expect(fake.calls.filter(call => call.range?.startsWith('Lines')))
        .toHaveLength(3)
    })

  it('keeps the tabs it read when the total cap of 24 MiB is reached',
    async () => {
      const answers = estimateGridAnswers()

      for (const sheetId of Object.values(SHEET_IDS)) {
        answers[sheetId] = gridAnswer(sheetId, 'T', {
          A1: { text: 'x'.repeat(2.5 * MEBIBYTE) },
        })
      }

      const fake = createFakeSheets({ answers })
      const result = await readSpreadsheetMap(inputOf(fake))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      expect(result.diagnostics.bytes).toBeLessThanOrEqual(24 * MEBIBYTE)
      expect(result.diagnostics.tabsNotRead).toBeGreaterThanOrEqual(1)
      expect(result.tabsImported).toBeLessThan(5)
      expect(result.tabsImported).toBeGreaterThanOrEqual(3)
      expect(result.diagnostics.failures.join(' ')).toContain('total_bytes')
    })

  it('puts tabs in tab order although the later ones answer first',
    async () => {
      const fake = createFakeSheets({
        delayMs: call => call.range?.startsWith('Lists') ? 30 : 0,
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      const headings = [...result.text.matchAll(/^## Sheet: (.*)$/gm)]
        .map(match => match[1])

      expect(headings).toEqual([
        'Lists',
        'Parameters',
        'Lines',
        'Extra\'s tab',
        'Summary',
      ])
    })

  it('never sends more than 22 requests, retries included', async () => {
    const sheets = Array.from({ length: 25 }, (_item, index) => ({
      properties: {
        sheetId: index + 1,
        title: `Tab${index + 1}`,
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
    }))
    const fake = createFakeSheets({
      metadata: { spreadsheetId: SPREADSHEET_ID, sheets },
      respond: (call) => {
        if (!call.range) {
          return undefined
        }

        const sheetId = Number(call.range.match(/^Tab(\d+)/)?.[1])

        return call.range.endsWith('1000')
          ? new Response('x'.repeat(13 * MEBIBYTE))
          : jsonResponse(gridAnswer(sheetId, `Tab${sheetId}`, {
            A1: { text: 'ok' },
          }))
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(fake.calls.length).toBeLessThanOrEqual(22)
    expect(result.diagnostics.requests).toBeLessThanOrEqual(22)
    expect(result.ok).toBe(false)
    expect(result.tabsTotal).toBe(25)
  })

  it('reads only the first 20 of 25 tabs, in 21 requests', async () => {
    const sheets = Array.from({ length: 25 }, (_item, index) => ({
      properties: {
        sheetId: index + 1,
        title: `Tab${index + 1}`,
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
    }))
    const fake = createFakeSheets({
      metadata: { spreadsheetId: SPREADSHEET_ID, sheets },
      respond: (call) => {
        const sheetId = Number(call.range?.match(/^Tab(\d+)/)?.[1])

        return call.range
          ? jsonResponse(gridAnswer(sheetId, `Tab${sheetId}`, {
            A1: { text: 'ok' },
          }))
          : undefined
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(fake.calls).toHaveLength(21)
    expect(result.ok && result.tabsImported).toBe(20)
    expect(result.tabsTotal).toBe(25)
  })

  it('stops reading tabs when the time budget is spent and names what was '
    + 'not read', async () => {
    let clock = 0
    const fake = createFakeSheets({
      respond: () => {
        clock += 6000

        return undefined
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake, {
      now: () => clock,
      wallTimeMs: 20_000,
    }))

    if (!result.ok) {
      throw new Error('expected a map')
    }

    expect(fake.calls.length).toBeLessThan(6)
    expect(result.diagnostics.tabsNotRead).toBe(6 - fake.calls.length)
    expect(result.diagnostics.failures.join(' ')).toContain('time_budget')
    expect(result.text).toContain('were not read')
  })

  it('falls back with no_access when the first tab is refused, and asks '
    + 'no more', async () => {
    const fake = createFakeSheets({
      respond: (call) => {
        return call.range
          ? jsonResponse(errorBody(403, 'PERMISSION_DENIED'), 403)
          : undefined
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(result).toMatchObject({
      ok: false,
      fallback: { code: 'sheets_no_access', status: 403, reason: null },
      tabsTotal: 5,
    })
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls.map(call => call.range)).not.toContain(
      'Summary!A1:Z1000',
    )
  })

  it('falls back with api_off when the API is disabled for the project',
    async () => {
      const fake = createFakeSheets({
        respond: () => jsonResponse(
          errorBody(403, 'PERMISSION_DENIED', 'SERVICE_DISABLED'),
          403,
        ),
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      expect(result).toMatchObject({
        ok: false,
        fallback: {
          code: 'sheets_api_off',
          status: 403,
          reason: 'SERVICE_DISABLED',
        },
        tabsTotal: null,
      })
      expect(fake.calls).toHaveLength(1)
      expect(result.diagnostics.failures[0])
        .toBe('structure:403:PERMISSION_DENIED:SERVICE_DISABLED')
    })

  it('falls back with quota on a Google 429 and never retries it', async () => {
    const fake = createFakeSheets({
      respond: () => jsonResponse(
        errorBody(429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED'),
        429,
      ),
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(result).toMatchObject({
      ok: false,
      fallback: { code: 'sheets_quota', status: 429 },
    })
    expect(fake.calls).toHaveLength(1)
  })

  it('keeps the tabs it read when a later tab answers 429, and stops',
    async () => {
      const fake = createFakeSheets({
        respond: (call) => {
          return call.range?.startsWith('Lines')
            ? jsonResponse(errorBody(429, 'RESOURCE_EXHAUSTED'), 429)
            : undefined
        },
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      expect(result.diagnostics.tabsNotRead).toBeGreaterThanOrEqual(1)
      expect(result.tabsImported).toBeLessThan(5)
      expect(result.text).toContain('## Sheet: Parameters')
      expect(result.diagnostics.failures[0]).toContain('RESOURCE_EXHAUSTED')
      expect(fake.calls.filter(call => call.range?.startsWith('Lines')))
        .toHaveLength(1)
    })

  it('falls back with a Besidka reason when its own bucket is empty, and '
    + 'sends nothing', async () => {
    const fake = createFakeSheets()
    const result = await readSpreadsheetMap(inputOf(fake, {
      reserve: vi.fn(async () => ({
        granted: 0,
        limitedBy: 'user',
        kvUnavailable: false,
      } satisfies SheetsReservation)),
    }))

    expect(result).toMatchObject({
      ok: false,
      fallback: {
        code: 'sheets_quota',
        status: 0,
        reason: 'besidka_user_limit',
      },
    })
    expect(fake.fetchImpl).not.toHaveBeenCalled()

    const app = await readSpreadsheetMap(inputOf(fake, {
      reserve: vi.fn(async () => ({
        granted: 0,
        limitedBy: 'app',
        kvUnavailable: false,
      } satisfies SheetsReservation)),
    }))

    expect(app.ok).toBe(false)
    expect(app.ok === false && app.fallback.reason)
      .toBe('besidka_app_limit')
  })

  it('reads only as many tabs as the bucket grants and names the rest',
    async () => {
      const fake = createFakeSheets()
      const reserve = vi.fn(async (count: number) => {
        return {
          granted: count === 1 ? 1 : 2,
          limitedBy: count === 1 ? null : 'user',
          kvUnavailable: false,
        } satisfies SheetsReservation
      })
      const result = await readSpreadsheetMap(inputOf(fake, { reserve }))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      expect(fake.calls).toHaveLength(3)
      expect(result.diagnostics.tabsNotRead).toBe(3)
      expect(result.diagnostics.failures.join(' ')).toContain(
        'besidka_user_limit',
      )
    })

  it('records that KV could not count, without refusing', async () => {
    const fake = createFakeSheets()
    const result = await readSpreadsheetMap(inputOf(fake, {
      reserve: vi.fn(async (count: number) => ({
        granted: count,
        limitedBy: null,
        kvUnavailable: true,
      } satisfies SheetsReservation)),
    }))

    expect(result.ok).toBe(true)
    expect(result.diagnostics.kvUnavailable).toBe(true)
  })

  it('falls back when no tab could be read, with the first failure',
    async () => {
      const fake = createFakeSheets({
        respond: (call) => {
          return call.range
            ? jsonResponse(errorBody(500, 'INTERNAL'), 500)
            : undefined
        },
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      expect(result).toMatchObject({
        ok: false,
        fallback: { code: 'sheets_unavailable', status: 500 },
        tabsTotal: 5,
      })
      expect(fake.calls).toHaveLength(6)
    })

  it('treats a timed-out request as too slow and an unreachable one as '
    + 'unavailable', async () => {
    const timedOut = createFakeSheets({
      respond: () => Object.assign(new Error('timeout'), { status: 504 }),
    })

    expect(await readSpreadsheetMap(inputOf(timedOut))).toMatchObject({
      ok: false,
      fallback: { code: 'sheets_too_large', reason: 'timeout' },
    })

    const unreachable = createFakeSheets({
      respond: () => new Error('network down'),
    })

    expect(await readSpreadsheetMap(inputOf(unreachable))).toMatchObject({
      ok: false,
      fallback: { code: 'sheets_unavailable', reason: 'unreachable' },
    })
  })

  it('falls back on a structure answer that is not JSON', async () => {
    const fake = createFakeSheets({
      respond: () => new Response('<html>no</html>'),
    })

    expect(await readSpreadsheetMap(inputOf(fake))).toMatchObject({
      ok: false,
      fallback: { code: 'sheets_unavailable', reason: 'malformed' },
      tabsTotal: null,
    })
  })

  it('falls back on a structure answer without sheets', async () => {
    const fake = createFakeSheets({
      metadata: { spreadsheetId: SPREADSHEET_ID, sheets: [] },
    })

    expect(await readSpreadsheetMap(inputOf(fake))).toMatchObject({
      ok: false,
      fallback: { reason: 'no_sheets' },
    })
  })

  it('knows the tab count when a one-tab workbook falls back', async () => {
    const fake = createFakeSheets({
      metadata: {
        spreadsheetId: SPREADSHEET_ID,
        sheets: [{ properties: { sheetId: 1, title: 'Only' } }],
      },
      respond: call => call.range
        ? jsonResponse(errorBody(403, 'PERMISSION_DENIED'), 403)
        : undefined,
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(result).toMatchObject({ ok: false, tabsTotal: 1 })
  })

  it('makes a map of a workbook with only a chart tab, without a cell '
    + 'request', async () => {
    const fake = createFakeSheets({
      metadata: {
        spreadsheetId: SPREADSHEET_ID,
        sheets: [{
          properties: { sheetId: 1, title: 'Chart', sheetType: 'OBJECT' },
          charts: [{ chartId: 1 }],
        }],
      },
    })
    const result = await readSpreadsheetMap(inputOf(fake))

    expect(result.ok).toBe(true)
    expect(fake.calls).toHaveLength(1)
  })

  it('refuses a spreadsheet id that is not a Drive id before any request',
    async () => {
      const fake = createFakeSheets()

      await expect(readSpreadsheetMap(inputOf(fake, {
        spreadsheetId: '../etc?x=1',
      }))).rejects.toThrow('Invalid Google Sheets spreadsheet id')
      expect(fake.fetchImpl).not.toHaveBeenCalled()
    })

  it('marks a workbook with more than 1,000 rows or 200 columns as cut',
    async () => {
      const fake = createFakeSheets({
        metadata: {
          spreadsheetId: SPREADSHEET_ID,
          sheets: [{
            properties: {
              sheetId: 1,
              title: 'Big',
              gridProperties: { rowCount: 5000, columnCount: 300 },
            },
          }],
        },
        respond: call => call.range
          ? jsonResponse(gridAnswer(1, 'Big', { A1: { text: 'x' } }))
          : undefined,
      })
      const result = await readSpreadsheetMap(inputOf(fake))

      if (!result.ok) {
        throw new Error('expected a map')
      }

      expect(fake.calls[1]?.range).toBe('Big!A1:GR1000')
      expect(result.text).toContain('Only the first 1000 rows were read')
      expect(result.text).toContain('Columns after GR are not included.')
    })
})
