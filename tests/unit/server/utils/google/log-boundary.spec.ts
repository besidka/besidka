import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const EXTRA_FILES = [
  'server/plugins/google-access-sweep.ts',
  'server/utils/account/purge-google-connections.ts',
]

interface AllowedRead {
  file: string
  line: RegExp
}

const ALLOWED_READS: AllowedRead[] = [
  {
    file: 'server/utils/google/byo-tools.ts',
    line: /context\.addIssue\(\{ code: 'custom', message: exception\.message/,
  },
  {
    file: 'server/utils/google/data-guard.ts',
    line: /const text = error instanceof Error \? error\.message : String\(error\)/,
  },
]

const MESSAGE_PATTERNS: RegExp[] = [
  /\bexceptionMessage\(/,
  /\berror:\s*\(?\w+ instanceof Error\s*\?\s*\w+\.message/,
  /\bmessage:\s*(exception|error|cause)\w*\.message\b/,
  /\bString\((exception|error)\)/,
]

const LOGGER_SET_MESSAGE_PATTERN = /\b(exception|error)\.message\b/

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return path.endsWith('.ts') ? [path] : []
  })
}

function listGoogleNamedFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory))
    .filter(name => name.endsWith('.ts') && name.includes('google'))
    .map(name => join(ROOT, directory, name))
}

function googleSources(): string[] {
  return [
    ...listTypeScriptFiles(join(ROOT, 'server/utils/google')),
    ...listTypeScriptFiles(join(ROOT, 'server/api/v1/google')),
    ...listGoogleNamedFiles('server/utils/tool-approval'),
    ...listGoogleNamedFiles('server/mcp/tools'),
    ...EXTRA_FILES.map(file => join(ROOT, file)),
  ]
}

function loggerSetCallsOf(source: string): string[] {
  const calls: string[] = []
  const opening = /\blogger\??\.set\(/g
  let match = opening.exec(source)

  while (match) {
    let depth = 1
    let cursor = match.index + match[0].length

    while (depth > 0 && cursor < source.length) {
      if (source[cursor] === '(') {
        depth += 1
      } else if (source[cursor] === ')') {
        depth -= 1
      }

      cursor += 1
    }

    calls.push(source.slice(match.index, cursor))
    match = opening.exec(source)
  }

  return calls
}

function findMessageLeaks(source: string, file: string): string[] {
  const allowedLines = ALLOWED_READS
    .filter(allowed => allowed.file === file)
    .map(allowed => allowed.line)
  const isAllowed = (text: string): boolean => {
    return allowedLines.some(line => line.test(text))
  }
  const leaks = source.split('\n').filter((line) => {
    return MESSAGE_PATTERNS.some(pattern => pattern.test(line))
      && !isAllowed(line)
  })
  const setCallLeaks = loggerSetCallsOf(source).filter((call) => {
    return LOGGER_SET_MESSAGE_PATTERN.test(call) && !isAllowed(call)
  })

  return [...leaks, ...setCallLeaks].map(text => text.trim())
}

describe('Google log boundary', () => {
  it('scans the Google routes, tools and approval files', () => {
    const files = googleSources().map(path => relative(ROOT, path))

    expect(files).toContain('server/utils/tool-approval/google.ts')
    expect(files).toContain('server/utils/tool-approval/google-run-gate.ts')
    expect(files).toContain('server/utils/account/purge-google-connections.ts')
    expect(files).toContain('server/mcp/tools/disconnect-google.ts')
    expect(files.some(file => file.startsWith('server/api/v1/google/')))
      .toBe(true)
  })

  it('never logs the message of a caught value', () => {
    const offenders = googleSources().flatMap((path) => {
      const file = relative(ROOT, path)

      return findMessageLeaks(readFileSync(path, 'utf8'), file)
        .map(text => `${file}: ${text}`)
    })

    expect(offenders).toEqual([])
  })

  it('keeps the allowlist of classification reads small', () => {
    expect(ALLOWED_READS.length).toBeLessThanOrEqual(3)
  })

  describe('scanner', () => {
    const FILE = 'server/utils/google/example.ts'

    it('catches exceptionMessage, String(exception) and message fields', () => {
      expect(findMessageLeaks('error: exceptionMessage(exception)', FILE))
        .toHaveLength(1)
      expect(findMessageLeaks('const text = String(exception)', FILE))
        .toHaveLength(1)
      expect(findMessageLeaks('{ message: exception.message }', FILE))
        .toHaveLength(1)
      expect(findMessageLeaks(
        'error: exception instanceof Error ? exception.message : \'x\'',
        FILE,
      )).toHaveLength(1)
    })

    it('catches exception.message inside a logger set call', () => {
      const source = [
        'logger.set({',
        '  attributes: { google: { reason: exception.message } },',
        '})',
      ].join('\n')

      expect(findMessageLeaks(source, FILE)).toHaveLength(1)
      expect(findMessageLeaks(
        'logger?.set({ google: { reason: error.message } })',
        FILE,
      )).toHaveLength(1)
    })

    it('lets a summary and a classification read through', () => {
      expect(findMessageLeaks(
        'logger.set({ google: { ...exceptionSummary(exception) } })',
        FILE,
      )).toEqual([])
      expect(findMessageLeaks(
        'const message = exception instanceof Error ? exception.message : \'\'',
        FILE,
      )).toEqual([])
    })
  })
})
