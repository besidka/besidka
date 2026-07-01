import { execFileSync } from 'node:child_process'
import {
  cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface MigrationsCheckResult {
  newSqlFiles: string[]
  forbiddenStatements: string[]
}

function runGenerateAgainstCopy(
  migrationsDir: string,
  schemaPath: string,
): MigrationsCheckResult {
  const workDir = mkdtempSync(join(tmpdir(), 'drizzle-clean-check-'))
  const outDir = join(workDir, 'migrations')

  try {
    cpSync(migrationsDir, outDir, { recursive: true })

    const before = new Set(readdirSync(outDir))

    const configPath = join(workDir, 'drizzle.config.ts')
    writeFileSync(
      configPath,
      [
        'import { defineConfig } from \'drizzle-kit\'',
        '',
        'export default defineConfig({',
        '  dialect: \'sqlite\',',
        `  schema: '${schemaPath}',`,
        `  out: '${outDir}',`,
        '})',
        '',
      ].join('\n'),
    )

    execFileSync(
      'pnpm',
      ['exec', 'drizzle-kit', 'generate', `--config=${configPath}`],
      { cwd: process.cwd(), stdio: 'pipe' },
    )

    const after = readdirSync(outDir)
    const newSqlFiles = after.filter((entry) => {
      return !before.has(entry)
    })

    const forbiddenStatements: string[] = []
    for (const entry of newSqlFiles) {
      const sqlPath = join(outDir, entry, 'migration.sql')
      const content = readFileIfExists(sqlPath)

      if (content && (/DROP TABLE/i.test(content) || /__new_/.test(content))) {
        forbiddenStatements.push(entry)
      }
    }

    return { newSqlFiles, forbiddenStatements }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function readFileIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

describe('drizzle migrations stay clean', () => {
  it('produces no new SQL for the main schema', () => {
    const result = runGenerateAgainstCopy(
      join(process.cwd(), '.drizzle/migrations'),
      join(process.cwd(), 'server/db/schema.ts'),
    )

    expect(result.newSqlFiles).toEqual([])
    expect(result.forbiddenStatements).toEqual([])
  }, 30_000)

  it('produces no new SQL for the consent schema', () => {
    const result = runGenerateAgainstCopy(
      join(process.cwd(), '.drizzle/migrations-consent'),
      join(process.cwd(), 'server/db/consent/schema.ts'),
    )

    expect(result.newSqlFiles).toEqual([])
    expect(result.forbiddenStatements).toEqual([])
  }, 30_000)
})
