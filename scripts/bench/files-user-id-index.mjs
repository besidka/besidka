#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Benchmarks `idx_files_user_id` against the `files` table's own hot-path
 * query: `SELECT COALESCE(SUM(size),0) FROM files WHERE user_id = ?`, used by
 * `getUserStorageUsageBytes()` in `server/utils/files/file-governance.ts`.
 *
 * This does NOT reproduce production latency (network hops, cold starts, and
 * D1's HTTP-based access pattern have zero equivalent on a local SQLite
 * file). What it DOES prove, deterministically, is the algorithmic shift
 * SQLite's query planner makes for this exact predicate once the index
 * exists: a full table `SCAN` becomes an indexed `SEARCH`, and how that
 * shows up as wall-clock time on a realistically sized, realistically skewed
 * dataset.
 *
 * The script builds a throwaway SQLite database (never the checked-in local
 * D1 state under `.wrangler/state/v3/d1`) under the OS temp directory,
 * recreates the `files` table DDL as Drizzle currently generates it (minus
 * foreign keys, which are irrelevant to this table's own index behavior),
 * seeds it with a power-law-skewed distribution of `user_id` values, times
 * the query before and after creating the index, and deletes the throwaway
 * database when done.
 *
 * Usage:
 *   pnpm run bench:files-index
 *   pnpm run bench:files-index -- --rows 250000 --users 3000
 *   pnpm run bench:files-index -- --iterations 2000 --seed 42
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const DEFAULT_ROW_COUNT = 120_000
const DEFAULT_USER_COUNT = 1_500
const DEFAULT_ITERATION_COUNT = 1_000
const WARMUP_ITERATION_COUNT = 50
const DEFAULT_SEED = 20260723

const USER_DISTRIBUTION_SKEW_EXPONENT = 1.1
const MIN_FILE_SIZE_BYTES = 1024
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

const CREATE_TABLE_SQL = `
  CREATE TABLE files (
    id integer PRIMARY KEY NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    user_id integer NOT NULL,
    storage_key text NOT NULL,
    name text NOT NULL,
    size integer NOT NULL,
    type text NOT NULL,
    source text DEFAULT 'upload' NOT NULL,
    expires_at integer,
    origin_message_id integer,
    origin_provider text,
    origin_model text,
    generation_cost real
  );
  CREATE UNIQUE INDEX uq_file_user ON files (id, user_id);
  CREATE UNIQUE INDEX \`uq_file_storageKey\` ON files (storage_key);
  CREATE INDEX idx_files_expires_at ON files (expires_at);
`

const CREATE_INDEX_SQL
  = 'CREATE INDEX `idx_files_user_id` ON `files` (`user_id`);'

const BENCHMARK_QUERY_SQL
  = 'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE user_id = ?'

const EXPLAIN_QUERY_PLAN_SQL = `EXPLAIN QUERY PLAN ${BENCHMARK_QUERY_SQL}`

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (!value.startsWith('--')) {
      continue
    }

    const key = value.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true

      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function createSeededRandom(seed) {
  let state = seed >>> 0

  return function random() {
    state = (state + 0x6d2b79f5) >>> 0

    let value = state

    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function buildUserIdCumulativeWeights(userCount) {
  const weights = Array.from({ length: userCount }, (_, index) => {
    return 1 / ((index + 1) ** USER_DISTRIBUTION_SKEW_EXPONENT)
  })
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const cumulativeWeights = []
  let runningTotal = 0

  for (const weight of weights) {
    runningTotal += weight / totalWeight
    cumulativeWeights.push(runningTotal)
  }

  return cumulativeWeights
}

function sampleUserId(cumulativeWeights, random) {
  const target = random()
  let low = 0
  let high = cumulativeWeights.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (cumulativeWeights[middle] < target) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low + 1
}

function sampleFileSizeBytes(random) {
  const minExponent = Math.log2(MIN_FILE_SIZE_BYTES)
  const maxExponent = Math.log2(MAX_FILE_SIZE_BYTES)
  const exponent = minExponent + (random() * (maxExponent - minExponent))

  return Math.round(2 ** exponent)
}

function createThrowawayDatabase() {
  const directory = mkdtempSync(
    join(tmpdir(), 'besidka-files-index-bench-'),
  )
  const path = join(directory, 'bench.sqlite')
  const db = new Database(path)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = OFF')
  db.exec(CREATE_TABLE_SQL)

  return { db, directory, path }
}

function seedFiles(db, rowCount, userCount, seed) {
  const random = createSeededRandom(seed)
  const cumulativeWeights = buildUserIdCumulativeWeights(userCount)
  const insert = db.prepare(`
    INSERT INTO files (
      id, created_at, updated_at, user_id, storage_key, name, size, type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((count) => {
    const now = Math.floor(Date.now() / 1000)

    for (let index = 1; index <= count; index += 1) {
      const userId = sampleUserId(cumulativeWeights, random)
      const size = sampleFileSizeBytes(random)

      insert.run(
        index,
        now,
        now,
        userId,
        `bench/${index}`,
        `file-${index}.bin`,
        size,
        'application/octet-stream',
      )
    }
  })

  insertAll(rowCount)
}

function readDistinctUserIds(db) {
  const rows = db.prepare('SELECT DISTINCT user_id FROM files').all()

  return rows.map(row => row.user_id)
}

function sampleBenchmarkUserIds(distinctUserIds, iterationCount, seed) {
  const random = createSeededRandom(seed + 1)
  const sampledUserIds = []

  for (let index = 0; index < iterationCount; index += 1) {
    const randomIndex = Math.floor(random() * distinctUserIds.length)

    sampledUserIds.push(distinctUserIds[randomIndex])
  }

  return sampledUserIds
}

function explainQueryPlan(db, userId) {
  const rows = db.prepare(EXPLAIN_QUERY_PLAN_SQL).all(userId)

  return rows.map(row => row.detail).join(' | ')
}

function benchmarkQuery(db, userIds) {
  const statement = db.prepare(BENCHMARK_QUERY_SQL)

  for (let index = 0; index < WARMUP_ITERATION_COUNT; index += 1) {
    statement.get(userIds[index % userIds.length])
  }

  const durationsInMilliseconds = []

  for (const userId of userIds) {
    const startedAt = process.hrtime.bigint()

    statement.get(userId)

    const finishedAt = process.hrtime.bigint()
    const durationInMilliseconds
      = Number(finishedAt - startedAt) / 1_000_000

    durationsInMilliseconds.push(durationInMilliseconds)
  }

  return durationsInMilliseconds
}

function computePercentile(sortedValues, percentile) {
  const rank = Math.ceil(percentile * sortedValues.length) - 1
  const index = Math.min(Math.max(rank, 0), sortedValues.length - 1)

  return sortedValues[index]
}

function computeStatistics(durationsInMilliseconds) {
  const sortedValues = [...durationsInMilliseconds].sort((left, right) => {
    return left - right
  })
  const sum = sortedValues.reduce((total, value) => total + value, 0)
  const mean = sum / sortedValues.length
  const median = computePercentile(sortedValues, 0.5)
  const p95 = computePercentile(sortedValues, 0.95)

  return { mean, median, p95 }
}

function formatMilliseconds(value) {
  return `${value.toFixed(4)}ms`
}

function printSummary(summary) {
  const {
    rowCount,
    userCount,
    iterationCount,
    beforePlan,
    afterPlan,
    beforeStatistics,
    afterStatistics,
  } = summary

  console.log('')
  console.log('=== files.user_id index benchmark ===')
  console.log(`Rows seeded:          ${rowCount}`)
  console.log(`Distinct user_ids:    ${userCount}`)
  console.log(`Timed iterations:     ${iterationCount}`)
  console.log('')
  console.log('Before (no index on user_id):')
  console.log(`  Query plan:  ${beforePlan}`)
  console.log(`  Mean:        ${formatMilliseconds(beforeStatistics.mean)}`)
  console.log(`  Median:      ${formatMilliseconds(beforeStatistics.median)}`)
  console.log(`  p95:         ${formatMilliseconds(beforeStatistics.p95)}`)
  console.log('')
  console.log('After (idx_files_user_id created):')
  console.log(`  Query plan:  ${afterPlan}`)
  console.log(`  Mean:        ${formatMilliseconds(afterStatistics.mean)}`)
  console.log(`  Median:      ${formatMilliseconds(afterStatistics.median)}`)
  console.log(`  p95:         ${formatMilliseconds(afterStatistics.p95)}`)
  console.log('')

  const meanSpeedup = beforeStatistics.mean / afterStatistics.mean
  const p95Speedup = beforeStatistics.p95 / afterStatistics.p95

  console.log(`Mean speedup: ${meanSpeedup.toFixed(2)}x`)
  console.log(`p95 speedup:  ${p95Speedup.toFixed(2)}x`)
  console.log('')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rowCount = Number(args.rows || DEFAULT_ROW_COUNT)
  const userCount = Number(args.users || DEFAULT_USER_COUNT)
  const iterationCount = Number(args.iterations || DEFAULT_ITERATION_COUNT)
  const seed = Number(args.seed || DEFAULT_SEED)

  const { db, directory } = createThrowawayDatabase()

  try {
    console.log(
      `Seeding ${rowCount} rows across ${userCount} distinct `
      + 'user_id values (power-law skewed)...',
    )
    seedFiles(db, rowCount, userCount, seed)

    const distinctUserIds = readDistinctUserIds(db)
    const sampledUserIds = sampleBenchmarkUserIds(
      distinctUserIds,
      iterationCount,
      seed,
    )

    console.log('Running "before" benchmark (full table scan expected)...')
    const beforePlan = explainQueryPlan(db, sampledUserIds[0])
    const beforeStatistics = computeStatistics(
      benchmarkQuery(db, sampledUserIds),
    )

    console.log(`Applying migration SQL: ${CREATE_INDEX_SQL}`)
    db.exec(CREATE_INDEX_SQL)

    console.log('Running "after" benchmark (index seek expected)...')
    const afterPlan = explainQueryPlan(db, sampledUserIds[0])
    const afterStatistics = computeStatistics(
      benchmarkQuery(db, sampledUserIds),
    )

    printSummary({
      rowCount,
      userCount: distinctUserIds.length,
      iterationCount,
      beforePlan,
      afterPlan,
      beforeStatistics,
      afterStatistics,
    })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

await main()
