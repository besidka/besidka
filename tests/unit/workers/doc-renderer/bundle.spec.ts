import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const WORKER_ROOT = resolve(REPOSITORY_ROOT, 'workers/doc-renderer')
const WRANGLER = resolve(REPOSITORY_ROOT, 'node_modules/.bin/wrangler')
const GZIP_LIMIT_KIB = 3000

const outputDirectories: string[] = []

function bundle(environment: string[]) {
  const outdir = mkdtempSync(resolve(tmpdir(), 'doc-renderer-bundle-'))

  outputDirectories.push(outdir)

  const output = execFileSync(
    WRANGLER,
    ['deploy', '--dry-run', '--outdir', outdir, ...environment],
    {
      cwd: WORKER_ROOT,
      encoding: 'utf8',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  return { outdir, output }
}

describe('doc-renderer Worker bundle', () => {
  afterAll(() => {
    for (const directory of outputDirectories) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['production', []],
    ['preview', ['--env', 'preview']],
  ])('bundles the %s Worker with its aliases and no bindings', (
    _name,
    environment,
  ) => {
    const { outdir, output } = bundle(environment as string[])
    const gzipKiB = Number(/gzip: ([\d.]+) KiB/.exec(output)?.[1])
    const code = readFileSync(resolve(outdir, 'index.js'), 'utf8')

    expect(output).toContain('No bindings found.')
    expect(gzipKiB).toBeGreaterThan(100)
    expect(gzipKiB).toBeLessThan(GZIP_LIMIT_KIB)
    expect(code).toContain('DocRenderer')
    expect(existsSync(resolve(outdir, 'index.js'))).toBe(true)
  }, 120_000)
})
