#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CPU and memory spike for `extractOfficeText` from
 * `@besidka/doc-renderer/extract`: a ~20 MB XLSX (generated, random numbers
 * and unique strings, so it does not compress better than a real workbook)
 * and a 300-slide PPTX (generated with pptxgenjs).
 *
 * Every case runs in a fresh child process, with the V8 heap capped at 64 MiB
 * so garbage collection keeps the resident set size close to live memory
 * (a Worker has 128 MiB in total), so the peak belongs to that one
 * extraction. The report gives the cold run and the
 * median of the warm runs, and fails the case unless the status is `ready`,
 * so a rejected file is never timed by mistake.
 *
 * Node timings are a lower bound for Workers: workerd runs the same V8 but
 * `wrangler dev` does not enforce `cpu_ms`, and `Date.now()` does not advance
 * during synchronous work there. To time the satellite itself, run the
 * harness in `scripts/bench/doc-renderer-extract-harness/` and pass
 * `--endpoint`.
 *
 * Usage:
 *   node scripts/bench/doc-renderer-extract.mjs
 *   node scripts/bench/doc-renderer-extract.mjs --runs 7 --slides 300
 *   node scripts/bench/doc-renderer-extract.mjs --endpoint http://127.0.0.1:8790
 *   node scripts/bench/doc-renderer-extract.mjs --keep /tmp/extract-fixtures
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../..')
const PACKAGE_ROOT = resolve(REPOSITORY_ROOT, 'packages/doc-renderer')
const DEFAULT_RUNS = 5
const DEFAULT_SLIDES = 300
const DEFAULT_SHEETS = 3
const DEFAULT_ROWS_PER_SHEET = 57_000
const COLUMNS_PER_ROW = 10
const DENSE_ROWS = 3000
const DENSE_COLUMNS = 200
const STRING_COLUMNS = 3
const MEBIBYTE = 1024 * 1024
const CPU_LIMIT_MS = 15_000
const CHILD_HEAP_LIMIT_MIB = 64
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PACKAGE
  = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? fallback : process.argv[index + 1]
}

function createRandom(seed) {
  let state = seed >>> 0

  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0

    return state / 0x100000000
  }
}

function columnLetter(index) {
  const first = index >= 26
    ? String.fromCharCode(64 + Math.floor(index / 26))
    : ''

  return `${first}${String.fromCharCode(65 + (index % 26))}`
}

function buildWorkbook(sheetCount, rowsPerSheet, columns, stringColumns) {
  const random = createRandom(20261112)
  const sharedStrings = []
  const files = {}

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const rows = []

    for (let rowIndex = 1; rowIndex <= rowsPerSheet; rowIndex += 1) {
      const cells = []

      for (let column = 0; column < columns; column += 1) {
        const reference = `${columnLetter(column)}${rowIndex}`

        if (column < stringColumns) {
          const word = `${random().toString(36).slice(2, 10)} Рядок `
            + `${Math.floor(random() * 1e9).toString(36)}`

          sharedStrings.push(word)
          cells.push(
            `<c r="${reference}" t="s"><v>${sharedStrings.length - 1}</v></c>`,
          )
        } else {
          cells.push(
            `<c r="${reference}"><v>${(random() * 100000).toFixed(4)}</v></c>`,
          )
        }
      }

      rows.push(`<row r="${rowIndex}">${cells.join('')}</row>`)
    }

    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(
      `${XML_HEADER}<worksheet xmlns="${NS_SHEET}"><sheetData>${
        rows.join('')
      }</sheetData></worksheet>`,
    )
  }

  const relationships = Array.from({ length: sheetCount }, (_value, index) => {
    return `<Relationship Id="rId${index + 1}" Type="${NS_RELATIONSHIPS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  }).join('')

  files['[Content_Types].xml'] = strToU8(
    `${XML_HEADER}<Types xmlns="${NS_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '</Types>',
  )
  files['_rels/.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE}">`
    + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>`
    + '</Relationships>',
  )
  files['xl/workbook.xml'] = strToU8(
    `${XML_HEADER}<workbook xmlns="${NS_SHEET}" xmlns:r="${NS_RELATIONSHIPS}"><sheets>${
      Array.from({ length: sheetCount }, (_value, index) => {
        return `<sheet name="Sheet ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      }).join('')
    }</sheets></workbook>`,
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE}">${relationships}`
    + `<Relationship Id="rId100" Type="${NS_RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/>`
    + '</Relationships>',
  )
  files['xl/sharedStrings.xml'] = strToU8(
    `${XML_HEADER}<sst xmlns="${NS_SHEET}">${
      sharedStrings.map(value => `<si><t>${value}</t></si>`).join('')
    }</sst>`,
  )

  return zipSync(files, { level: 6 })
}

async function buildPresentation(slideCount) {
  const require = createRequire(resolve(PACKAGE_ROOT, 'package.json'))
  const loaded = require('pptxgenjs')
  const PptxGenJS = loaded.default ?? loaded
  const presentation = new PptxGenJS()

  for (let index = 1; index <= slideCount; index += 1) {
    const slide = presentation.addSlide()

    slide.addText(`Слайд ${index}: quarterly review`, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
    })
    slide.addText(
      Array.from({ length: 8 }, (_value, bullet) => ({
        text: `Пункт ${bullet + 1} of slide ${index}: revenue grew by ${
          (index * 7 + bullet) % 40
        } percent against the previous period.`,
        options: { bullet: true, breakLine: true },
      })),
      { x: 0.5, y: 1.3, w: 9, h: 4, fontSize: 16 },
    )
    slide.addTable(
      [
        [{ text: 'Region' }, { text: 'Q1' }, { text: 'Q2' }],
        [{ text: 'Kyiv' }, { text: `${index * 3}` }, { text: `${index * 4}` }],
        [{ text: 'Lviv' }, { text: `${index * 5}` }, { text: `${index * 6}` }],
      ],
      { x: 0.5, y: 5.2, w: 9 },
    )
    slide.addNotes(`Speaker notes for slide ${index}: mention the budget.`)
  }

  return presentation.write({ outputType: 'uint8array' })
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length / 2)]
}

async function runChild() {
  const file = readOption('file')
  const format = readOption('format')
  const runs = Number(readOption('runs', DEFAULT_RUNS))
  const { extractOfficeText } = await import(
    pathToFileURL(resolve(PACKAGE_ROOT, 'src/extract/index.ts')).href
  )
  const bytes = new Uint8Array(readFileSync(file))
  const baselineRss = process.memoryUsage().rss
  const timings = []
  let last = null

  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now()

    last = extractOfficeText(bytes, format)
    timings.push(performance.now() - startedAt)
  }

  console.log(JSON.stringify({
    status: last.status,
    errorCode: last.errorCode,
    truncated: last.truncated,
    stats: last.stats,
    timings,
    baselineRss,
    peakRss: process.resourceUsage().maxRSS * 1024,
  }))
}

function measureInChild(file, format, runs) {
  const result = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${CHILD_HEAP_LIMIT_MIB}`,
      SCRIPT_PATH,
      '--child',
      '--file',
      file,
      '--format',
      format,
      '--runs',
      `${runs}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * MEBIBYTE },
  )

  if (result.status !== 0) {
    throw new Error(`Child failed: ${result.stderr}`)
  }

  return JSON.parse(result.stdout.trim().split('\n').pop())
}

async function measureEndpoint(endpoint, file, format, runs) {
  const bytes = readFileSync(file)
  const timings = []
  let last = null

  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now()
    const response = await fetch(`${endpoint}/?format=${format}`, {
      method: 'POST',
      body: bytes,
    })

    last = await response.json()
    timings.push(performance.now() - startedAt)
  }

  return { ...last, timings }
}

function report(name, bytes, outcome) {
  const cold = outcome.timings[0]
  const warm = outcome.timings.slice(1)
  const peakDeltaMiB = outcome.peakRss === undefined
    ? undefined
    : (outcome.peakRss - outcome.baselineRss) / MEBIBYTE

  console.log(`\n${name}`)
  console.log(`  input        ${(bytes / MEBIBYTE).toFixed(1)} MiB`)
  console.log(`  status       ${outcome.status}${outcome.errorCode ? ` (${outcome.errorCode})` : ''}`)
  console.log(`  text         ${(outcome.stats.textBytes / 1024).toFixed(0)} KiB, truncated=${outcome.truncated} [${outcome.stats.truncations.join(', ')}]`)
  console.log(`  cold         ${cold.toFixed(0)} ms`)

  if (warm.length > 0) {
    console.log(`  warm median  ${median(warm).toFixed(0)} ms (min ${Math.min(...warm).toFixed(0)}, max ${Math.max(...warm).toFixed(0)}, n=${warm.length})`)
  }

  if (peakDeltaMiB !== undefined) {
    console.log(`  peak RSS     ${(outcome.peakRss / MEBIBYTE).toFixed(0)} MiB (+${peakDeltaMiB.toFixed(0)} MiB over the loaded file)`)
  }

  console.log(`  vs ${CPU_LIMIT_MS / 1000} s limit  ${(cold / CPU_LIMIT_MS * 100).toFixed(1)}% of the CPU budget (cold)`)

  if (outcome.status !== 'ready') {
    throw new Error(`${name} did not extract: ${outcome.status} ${outcome.errorCode}`)
  }
}

async function main() {
  if (process.argv.includes('--child')) {
    await runChild()

    return
  }

  const runs = Number(readOption('runs', DEFAULT_RUNS))
  const endpoint = readOption('endpoint')
  const keepDirectory = readOption('keep')
  const directory = keepDirectory ?? mkdtempSync(
    join(tmpdir(), 'doc-renderer-extract-'),
  )

  try {
    const workbook = buildWorkbook(
      Number(readOption('sheets', DEFAULT_SHEETS)),
      Number(readOption('rows', DEFAULT_ROWS_PER_SHEET)),
      COLUMNS_PER_ROW,
      STRING_COLUMNS,
    )
    const denseSheet = buildWorkbook(1, DENSE_ROWS, DENSE_COLUMNS, 0)
    const deck = await buildPresentation(
      Number(readOption('slides', DEFAULT_SLIDES)),
    )
    const cases = [
      ['XLSX (3 sheets, unique strings)', 'xlsx', workbook],
      ['XLSX (one dense 200-column sheet)', 'xlsx', denseSheet],
      ['PPTX (slides)', 'pptx', deck],
    ]

    for (const [name, format, bytes] of cases) {
      const file = join(directory, `bench.${format}`)

      writeFileSync(file, bytes)

      const outcome = endpoint
        ? await measureEndpoint(endpoint, file, format, runs)
        : measureInChild(file, format, runs)

      report(
        endpoint ? `${name} via ${endpoint}` : name,
        bytes.length,
        outcome,
      )
    }
  } finally {
    if (!keepDirectory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

await main()
