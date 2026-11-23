import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const EXTRA_FILES = ['server/plugins/google-access-sweep.ts']

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return path.endsWith('.ts') ? [path] : []
  })
}

function googleSources(): string[] {
  return [
    ...listTypeScriptFiles(join(ROOT, 'server/utils/google')),
    ...EXTRA_FILES.map(file => join(ROOT, file)),
  ]
}

describe('Google log boundary', () => {
  it('never logs the message of a caught value', () => {
    const offenders = googleSources().filter((path) => {
      return /\bexceptionMessage\(/.test(readFileSync(path, 'utf8'))
    })

    expect(offenders.map(path => relative(ROOT, path))).toEqual([])
  })

  it('never puts the message of a caught value into a log field', () => {
    const offenders = googleSources().filter((path) => {
      return /\berror:\s*\(?\w+ instanceof Error\s*\?\s*\w+\.message/.test(
        readFileSync(path, 'utf8'),
      )
    })

    expect(offenders.map(path => relative(ROOT, path))).toEqual([])
  })
})
